#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Keep the "On Your Left roadmap" GitHub Project in step with the issues -- #1348.
#
# Run: python3 -I scripts/sync-roadmap.py --org openzigs --project 1 [--dry-run] [--status-update]
#
# The token comes from GH_TOKEN or GITHUB_TOKEN. It is put in one request header
# and nowhere else: never printed, never logged, never in an error message.
# Standard library only -- no dependency, nothing to install.
#
# What it does, in order (docs/roadmap-board.md is the reader's version):
#   1. Reads every issue in openzigs/onyourleft that is open, closed in the last
#      30 days, or a closed epic -- labels, state, parent, subIssuesSummary --
#      paged by 100, plus any ancestor outside that set (for Tier inheritance).
#      Pull requests are not issues and are never read or added.
#   2. Reads every item already on the board, once, into a map.
#   3. ADDS every open issue and every closed epic that is not on the board.
#      Never deletes, never archives, never touches an archived item.
#   4. SETS Tier, Kind, Area, Progress % and Sub-issues done, only where the
#      value differs, and on epics alone the dates Start and Target (#1391), from
#      each epic's sub-issues, so the Roadmap view draws a bar. NEVER touches
#      Status: GitHub's built-in workflows own it.
#   5. With --status-update, posts a weekly status update unless one was posted
#      in the last 6 days. It lists the open issues with no `area:` label, the
#      Unranked ones (docs/agents/filing-issues.md) and the open epics with no
#      recent progress, and every run prints the label gaps' count.
#
# Writes are throttled to about one a second and capped below 400 a run (GitHub's
# secondary limit is about 80 content-creating requests a minute and 500 an
# hour); a first fill that hits the cap carries on the next night. Running it
# twice changes nothing the second time: addProjectV2ItemById on an issue that is
# already on the board returns the SAME item (measured 2026-10-14 on #1348: two
# calls, one item id, one createdAt), and every field write is skipped when the
# board already holds the value.
#
# Everything that decides a value is a pure function above the `--- I/O ---`
# line, tested by scripts/sync-roadmap.test.py.

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

REPO_OWNER = "openzigs"
REPO_NAME = "onyourleft"
CLOSED_WINDOW_DAYS = 30
MAX_MUTATIONS = 399
MUTATION_INTERVAL_S = 1.0
STATUS_UPDATE_MIN_AGE_DAYS = 6
STATUS_UPDATE_WINDOW_DAYS = 7
STATUS_LIST_CAP = 40
PACE_WINDOW_DAYS = 28
PACE_FALLBACK_DAYS = 90
TARGET_CAP_DAYS = 730

# Precedence is the field's option order: the first of these an issue carries
# wins. `priority: high` is the owner's device-check list (#733).
TIER_BY_LABEL = (
    ("priority: now", "Now"),
    ("priority: next", "Next"),
    ("priority: later", "Later"),
    ("priority: high", "Device check"),
)
UNRANKED = "Unranked"
AREA_PREFIX = "area:"

TIER = "Tier"
KIND = "Kind"
AREA = "Area"
PROGRESS = "Progress %"
SUBS_DONE = "Sub-issues done"
START = "Start"
TARGET = "Target"
# The order fields are written in, and the only fields this script ever writes.
MANAGED_FIELDS = (TIER, KIND, AREA, PROGRESS, SUBS_DONE, START, TARGET)
NUMBER_FIELDS = (PROGRESS,)
TEXT_FIELDS = (SUBS_DONE,)
# Written on epics only, as "YYYY-MM-DD"; created by the script when missing.
DATE_FIELDS = (START, TARGET)


# --- Decisions (pure) ---------------------------------------------------------


def own_tier(labels):
    """The Tier an issue's own `priority:` labels give it, or None."""
    names = set(labels)
    for label, tier in TIER_BY_LABEL:
        if label in names:
            return tier
    return None


def resolve_tier(number, issues):
    """Own label first, else the nearest ancestor's, else Unranked.

    `issues` maps number -> issue dict. A parent that is not in the map ends the
    walk, and so does a cycle, which GitHub should not allow but costs nothing
    to refuse.
    """
    seen = set()
    current = issues.get(number)
    while current is not None and current["number"] not in seen:
        seen.add(current["number"])
        tier = own_tier(current["labels"])
        if tier is not None:
            return tier
        parent = current.get("parent")
        current = issues.get(parent) if parent is not None else None
    return UNRANKED


def kind_of(issue):
    labels = set(issue["labels"])
    if "epic" in labels:
        return "Epic"
    if issue["title"].lstrip().lower().startswith("spike"):
        return "Spike"
    if "bug" in labels:
        return "Bug"
    return "Issue"


def area_of(labels):
    """`area: racing` -> `racing`. Several: the first by name, so it is stable."""
    areas = sorted(
        label[len(AREA_PREFIX):].strip()
        for label in labels
        if label.startswith(AREA_PREFIX) and label[len(AREA_PREFIX):].strip()
    )
    return areas[0] if areas else None


def progress_of(summary):
    """(Progress %, Sub-issues done) from subIssuesSummary; (None, None) clears."""
    if not summary or not summary.get("total"):
        return None, None
    return (
        summary["percentCompleted"],
        "%d of %d" % (summary["completed"], summary["total"]),
    )


def is_epic(issue):
    return "epic" in issue["labels"]


def _date(value):
    return parse_time(value).date()


def start_of(epic):
    """The earliest createdAt of the epic and its sub-issues, as "YYYY-MM-DD"."""
    return min(_date(i["createdAt"]) for i in [epic] + epic.get("subs", [])).isoformat()


def _closed_since(subs, now, days):
    since = now - dt.timedelta(days=days)
    return sum(
        1 for s in subs if s["state"] == "CLOSED" and s.get("closedAt") and parse_time(s["closedAt"]) >= since
    )


def target_of(epic, now):
    """The projected end, as "YYYY-MM-DD"; None (cleared) when nothing has closed in 90 days.

    Closed: the epic's own close. Open: today + ceil(open sub-issues / weekly
    pace) weeks, the pace being the last 28 days' closes / 4, else the last 90
    days' / (90/7); capped at TARGET_CAP_DAYS ahead. Integer arithmetic, so a
    pace like 7/90 a week rounds exactly.
    """
    if epic["state"] == "CLOSED":
        return _date(epic["closedAt"]).isoformat()
    today = now.date()
    subs = epic.get("subs", [])
    open_count = sum(1 for s in subs if s["state"] == "OPEN")
    if open_count == 0:
        return today.isoformat()
    recent = _closed_since(subs, now, PACE_WINDOW_DAYS)
    if recent:
        weeks = -(-open_count * (PACE_WINDOW_DAYS // 7) // recent)
    else:
        slow = _closed_since(subs, now, PACE_FALLBACK_DAYS)
        if not slow:
            return None
        weeks = -(-open_count * PACE_FALLBACK_DAYS // (7 * slow))
    days = min(weeks * 7, TARGET_CAP_DAYS)
    return (today + dt.timedelta(days=days)).isoformat()


def no_recent_progress(issues, now):
    """Open epics whose Target is cleared: open sub-issues, none closed in 90 days."""
    return sorted(
        (i for i in issues if is_epic(i) and i["state"] == "OPEN" and target_of(i, now) is None),
        key=lambda i: i["number"],
    )


def desired_fields(issue, issues, now):
    """Every managed field for an epic; the date fields are absent, so untouched, on anything else."""
    progress, done = progress_of(issue.get("summary"))
    desired = {
        TIER: resolve_tier(issue["number"], issues),
        KIND: kind_of(issue),
        AREA: area_of(issue["labels"]),
        PROGRESS: progress,
        SUBS_DONE: done,
    }
    if is_epic(issue):
        desired[START] = start_of(issue)
        desired[TARGET] = target_of(issue, now)
    return desired


def _same(field, want, have):
    if want is None or have is None:
        return want is None and have is None
    if field in NUMBER_FIELDS:
        return float(want) == float(have)
    return want == have


def field_changes(desired, current):
    """[(field, value)] for every desired managed field whose value differs; None clears."""
    return [
        (field, desired[field])
        for field in MANAGED_FIELDS
        if field in desired and not _same(field, desired[field], current.get(field))
    ]


def should_add(issue):
    """Open issues, and epics whatever their state."""
    return issue["state"] == "OPEN" or "epic" in issue["labels"]


def in_read_window(issue, now):
    """Open, closed within the window, or a closed epic."""
    if issue["state"] == "OPEN" or "epic" in issue["labels"]:
        return True
    closed = parse_time(issue.get("closedAt"))
    return closed is not None and now - closed <= dt.timedelta(days=CLOSED_WINDOW_DAYS)


def missing_area_options(issues, options):
    """Area names some issue needs that the field has no option for, sorted."""
    have = set(options)
    return sorted({a for a in (area_of(i["labels"]) for i in issues) if a and a not in have})


def parse_time(value):
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def status_update_due(last_created_at, now):
    last = parse_time(last_created_at)
    return last is None or now - last >= dt.timedelta(days=STATUS_UPDATE_MIN_AGE_DAYS)


def status_update_status(last_status):
    """Carry the owner's last setting forward; On track when there is none."""
    return last_status or "ON_TRACK"


def _issue_lines(issues):
    lines = ["- #%d %s" % (i["number"], i["title"]) for i in issues[:STATUS_LIST_CAP]]
    if len(issues) > STATUS_LIST_CAP:
        lines.append("- and %d more" % (len(issues) - STATUS_LIST_CAP))
    return lines or ["- none"]


def label_gaps(issues):
    """Open issues the board cannot place: (no `area:` label, Unranked), each by number.

    docs/agents/filing-issues.md is what every issue should carry. An epic needs
    its own `priority:` label; any other issue may take its Tier from its epic.
    """
    lookup = {i["number"]: i for i in issues}
    open_issues = sorted((i for i in issues if i["state"] == "OPEN"), key=lambda i: i["number"])
    no_area = [i for i in open_issues if area_of(i["labels"]) is None]
    unranked = [i for i in open_issues if resolve_tier(i["number"], lookup) == UNRANKED]
    return no_area, unranked


def status_update_body(issues, now):
    """Written from the issues alone: what closed in the last 7 days, what is Now."""
    since = now - dt.timedelta(days=STATUS_UPDATE_WINDOW_DAYS)
    closed = sorted(
        (
            i
            for i in issues
            if i["state"] == "CLOSED"
            and parse_time(i.get("closedAt")) is not None
            and parse_time(i["closedAt"]) >= since
        ),
        key=lambda i: i["number"],
    )
    current = sorted(
        (i for i in issues if i["state"] == "OPEN" and "priority: now" in i["labels"]),
        key=lambda i: i["number"],
    )
    return "\n".join(
        ["**Week to %s.** Written by scripts/sync-roadmap.py from the issues." % now.date().isoformat(),
         "",
         "**Closed in the last 7 days (%d)**" % len(closed)]
        + _issue_lines(closed)
        + ["", "**`priority: now` (%d)**" % len(current)]
        + _issue_lines(current)
        + _gap_lines(issues)
        + _stalled_lines(issues, now)
    )


def _gap_lines(issues):
    """The label gaps, as a section only when there are any."""
    no_area, unranked = label_gaps(issues)
    lines = []
    if no_area:
        lines += ["", "**Needs an `area:` label (%d)**" % len(no_area)] + _issue_lines(no_area)
    if unranked:
        lines += ["", "**Unranked: no `priority:` label, own or its epic's (%d)**" % len(unranked)]
        lines += _issue_lines(unranked)
    return lines


def _stalled_lines(issues, now):
    """The open epics with no Target, as a section only when there are any."""
    stalled = no_recent_progress(issues, now)
    if not stalled:
        return []
    return ["", "**No recent progress: no sub-issue closed in 90 days, so no Target (%d)**" % len(stalled)] + \
        _issue_lines(stalled)


def gaps_line(issues):
    no_area, unranked = label_gaps(issues)
    return "labels: %d open without an area, %d unranked" % (len(no_area), len(unranked))


def summary_line(counts):
    return "summary: added %d, changed %d, unchanged %d, skipped %d" % (
        counts["added"],
        counts["changed"],
        counts["unchanged"],
        counts["skipped"],
    )


# --- I/O ----------------------------------------------------------------------

API_URL = "https://api.github.com/graphql"


class GraphQLError(RuntimeError):
    pass


class Client:
    def __init__(self, token, dry_run):
        self._token = token
        self.dry_run = dry_run
        self.mutations = 0
        self._last = 0.0

    def _post(self, query, variables):
        body = json.dumps({"query": query, "variables": variables}).encode()
        request = urllib.request.Request(
            API_URL,
            data=body,
            headers={
                "Authorization": "bearer " + self._token,
                "Content-Type": "application/json",
                "User-Agent": "onyourleft-sync-roadmap",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            # The status and GitHub's own message; never the request, whose
            # headers hold the token.
            try:
                message = json.load(error).get("message", "")
            except (ValueError, AttributeError):
                message = ""
            raise GraphQLError("GitHub API HTTP %d %s" % (error.code, message)) from None
        except urllib.error.URLError as error:
            raise GraphQLError("GitHub API unreachable: %s" % error.reason) from None
        if payload.get("errors"):
            raise GraphQLError("; ".join(e.get("message", "?") for e in payload["errors"]))
        return payload["data"]

    def query(self, query, **variables):
        return self._post(query, variables)

    def budget_left(self):
        return self.mutations < MAX_MUTATIONS

    def mutate(self, description, query, **variables):
        """Prints the change; in a dry run that is all it does."""
        print(("would " if self.dry_run else "") + description)
        if self.dry_run:
            return None
        wait = MUTATION_INTERVAL_S - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self.mutations += 1
        try:
            return self._post(query, variables)
        finally:
            self._last = time.monotonic()


ISSUE_FIELDS = """
  id number title state createdAt closedAt
  labels(first: 50) { nodes { name } }
  parent { number }
  subIssuesSummary { total completed percentCompleted }
"""

ISSUES_QUERY = (
    """
query($owner: String!, $name: String!, $after: String, $filter: IssueFilters) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, filterBy: $filter,
           orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { %s }
    }
  }
}"""
    % ISSUE_FIELDS
)

SUB_ISSUES_QUERY = """
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      subIssues(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { createdAt closedAt state }
      }
    }
  }
}"""

ONE_ISSUE_QUERY = (
    """
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { %s } }
}"""
    % ISSUE_FIELDS
)

PROJECT_QUERY = """
query($org: String!, $number: Int!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes {
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField { options { id name color description } }
        }
      }
      statusUpdates(first: 100) { nodes { createdAt status } }
    }
  }
}"""

ITEMS_QUERY = """
query($org: String!, $number: Int!, $after: String) {
  organization(login: $org) {
    projectV2(number: $number) {
      items(first: 100, after: $after, archivedStates: [ARCHIVED, NOT_ARCHIVED]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isArchived
          content { ... on Issue { number repository { nameWithOwner } } }
          fieldValues(first: 30) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldNumberValue {
                number field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldTextValue {
                text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldDateValue {
                date field { ... on ProjectV2FieldCommon { name } } }
            }
          }
        }
      }
    }
  }
}"""

ADD_ITEM = """
mutation($project: ID!, $content: ID!) {
  addProjectV2ItemById(input: {projectId: $project, contentId: $content}) { item { id } }
}"""

SET_VALUE = """
mutation($project: ID!, $item: ID!, $field: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item,
                                        fieldId: $field, value: $value}) { projectV2Item { id } }
}"""

CLEAR_VALUE = """
mutation($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field}) {
    projectV2Item { id } }
}"""

CREATE_FIELD = """
mutation($project: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
  createProjectV2Field(input: {projectId: $project, dataType: SINGLE_SELECT, name: $name,
                               singleSelectOptions: $options}) {
    projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name color description } } }
  }
}"""

CREATE_DATE_FIELD = """
mutation($project: ID!, $name: String!) {
  createProjectV2Field(input: {projectId: $project, dataType: DATE, name: $name}) {
    projectV2Field { ... on ProjectV2Field { id name } }
  }
}"""

UPDATE_FIELD = """
mutation($field: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
  updateProjectV2Field(input: {fieldId: $field, singleSelectOptions: $options}) {
    projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name color description } } }
  }
}"""

STATUS_UPDATE = """
mutation($project: ID!, $status: ProjectV2StatusUpdateStatus!, $body: String!, $start: Date!) {
  createProjectV2StatusUpdate(input: {projectId: $project, status: $status, body: $body,
                                      startDate: $start}) { statusUpdate { id } }
}"""


def _issue_from_node(node):
    return {
        "id": node["id"],
        "number": node["number"],
        "title": node["title"],
        "state": node["state"],
        "createdAt": node.get("createdAt"),
        "closedAt": node.get("closedAt"),
        "labels": [label["name"] for label in node["labels"]["nodes"]],
        "parent": (node.get("parent") or {}).get("number"),
        "summary": node.get("subIssuesSummary"),
    }


def read_issues(client, now):
    """Open issues, issues closed in the window, and every closed epic."""
    since = (now - dt.timedelta(days=CLOSED_WINDOW_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    # A close updates the issue, so `since` on updatedAt catches every close in
    # the window; in_read_window then drops the ones only edited in it.
    filters = (
        {"states": ["OPEN"]},
        {"states": ["CLOSED"], "since": since},
        {"states": ["CLOSED"], "labels": ["epic"]},
    )
    issues = {}
    for filter_ in filters:
        after = None
        while True:
            data = client.query(ISSUES_QUERY, owner=REPO_OWNER, name=REPO_NAME, after=after, filter=filter_)
            page = data["repository"]["issues"]
            for node in page["nodes"]:
                issue = _issue_from_node(node)
                if in_read_window(issue, now):
                    issues[issue["number"]] = issue
            if not page["pageInfo"]["hasNextPage"]:
                break
            after = page["pageInfo"]["endCursor"]
    return issues


def read_sub_issues(client, issues):
    """Puts each epic's sub-issues (createdAt, closedAt, state) on it as "subs".

    One query per epic, paged by 100: the epics are a few dozen, and reading
    sub-issues for every issue in the main query would cost far more points.
    """
    for epic in issues.values():
        if not is_epic(epic):
            continue
        subs = []
        after = None
        while True:
            data = client.query(SUB_ISSUES_QUERY, owner=REPO_OWNER, name=REPO_NAME, number=epic["number"], after=after)
            page = data["repository"]["issue"]["subIssues"]
            subs.extend(page["nodes"])
            if not page["pageInfo"]["hasNextPage"]:
                break
            after = page["pageInfo"]["endCursor"]
        epic["subs"] = subs


def read_ancestors(client, issues):
    """Ancestors outside the read set, kept apart: they decide Tier, nothing else."""
    ancestors = {}
    pending = {i["parent"] for i in issues.values() if i["parent"] is not None}
    while pending:
        number = pending.pop()
        if number in issues or number in ancestors:
            continue
        node = client.query(ONE_ISSUE_QUERY, owner=REPO_OWNER, name=REPO_NAME, number=number)
        node = node["repository"]["issue"]
        if node is None:
            continue
        ancestor = _issue_from_node(node)
        ancestors[number] = ancestor
        if ancestor["parent"] is not None:
            pending.add(ancestor["parent"])
    return ancestors


def read_items(client, org, number):
    """number -> {"id", "archived", "values": {field name: value}} for this repo's issues."""
    items = {}
    after = None
    repo = "%s/%s" % (REPO_OWNER, REPO_NAME)
    while True:
        data = client.query(ITEMS_QUERY, org=org, number=number, after=after)
        page = data["organization"]["projectV2"]["items"]
        for node in page["nodes"]:
            content = node.get("content") or {}
            if "number" not in content or content["repository"]["nameWithOwner"] != repo:
                continue
            values = {}
            for value in node["fieldValues"]["nodes"]:
                field = (value.get("field") or {}).get("name")
                if field is None:
                    continue
                for key in ("name", "number", "text", "date"):
                    if key in value:
                        values[field] = value[key]
            items[content["number"]] = {"id": node["id"], "archived": node["isArchived"], "values": values}
        if not page["pageInfo"]["hasNextPage"]:
            break
        after = page["pageInfo"]["endCursor"]
    return items


def _option_inputs(options):
    return [
        {"id": o["id"], "name": o["name"], "color": o.get("color") or "GRAY", "description": o.get("description") or ""}
        for o in options
    ]


def ensure_area_options(client, project_id, fields, issues):
    """Creates the Area field, or adds the options an `area:` label needs.

    Existing options are sent back WITH their ids: updateProjectV2Field replaces
    the whole option list, and an option sent without its id is a new option,
    which would empty every item that held the old one.
    """
    field = fields.get(AREA)
    have = [o["name"] for o in field["options"]] if field else []
    missing = missing_area_options(issues, have)
    if not missing or not client.budget_left():
        return
    new = [{"name": name, "color": "GRAY", "description": ""} for name in missing]
    if field is None:
        data = client.mutate("create field Area with options " + ", ".join(missing), CREATE_FIELD,
                             project=project_id, name=AREA, options=new)
        result = data and data["createProjectV2Field"]["projectV2Field"]
    else:
        data = client.mutate("add Area options " + ", ".join(missing), UPDATE_FIELD,
                             field=field["id"], options=_option_inputs(field["options"]) + new)
        result = data and data["updateProjectV2Field"]["projectV2Field"]
    if result:
        fields[AREA] = {"id": result["id"], "dataType": "SINGLE_SELECT", "options": result["options"]}
    elif client.dry_run:
        # So a dry run can show the values it would then set.
        fields[AREA] = {"id": None, "dataType": "SINGLE_SELECT",
                        "options": [{"id": None, "name": n} for n in have + missing]}


def ensure_date_fields(client, project_id, fields):
    """Creates Start and Target as DATE fields when the board has none by that name.

    A field of that name with another type is left alone and not written:
    the script never changes a field's type.
    """
    for name in DATE_FIELDS:
        field = fields.get(name)
        if field is not None:
            if field.get("dataType") != "DATE":
                print("skip %s: the board's field of that name is %s, not DATE" % (name, field.get("dataType")))
                del fields[name]
            continue
        if not client.budget_left():
            return
        data = client.mutate("create date field " + name, CREATE_DATE_FIELD, project=project_id, name=name)
        if data:
            fields[name] = {"id": data["createProjectV2Field"]["projectV2Field"]["id"], "dataType": "DATE"}
        elif client.dry_run:
            fields[name] = {"id": None, "dataType": "DATE"}


def write_field(client, project_id, item_id, fields, number, field_name, value):
    field = fields[field_name]
    label = "#%d %s -> %s" % (number, field_name, "(clear)" if value is None else value)
    if value is None:
        client.mutate("set " + label, CLEAR_VALUE, project=project_id, item=item_id, field=field["id"])
        return
    if field_name in NUMBER_FIELDS:
        encoded = {"number": float(value)}
    elif field_name in TEXT_FIELDS:
        encoded = {"text": value}
    elif field_name in DATE_FIELDS:
        encoded = {"date": value}
    else:
        option = next((o for o in field["options"] if o["name"] == value), None)
        if option is None:
            print("skip #%d %s: no option named %r on the board" % (number, field_name, value))
            return
        encoded = {"singleSelectOptionId": option["id"]}
    client.mutate("set " + label, SET_VALUE, project=project_id, item=item_id, field=field["id"], value=encoded)


def maybe_post_status_update(client, project_id, updates, issues, now):
    latest = max(updates, key=lambda u: u["createdAt"], default=None)
    if not status_update_due(latest and latest["createdAt"], now):
        print("status update: skipped, one was posted %s" % latest["createdAt"])
        return
    if not client.budget_left():
        print("status update: skipped, the run's write budget is spent")
        return
    status = status_update_status(latest and latest["status"])
    body = status_update_body(list(issues.values()), now)
    client.mutate("post status update (%s):\n%s" % (status, body), STATUS_UPDATE,
                  project=project_id, status=status, body=body, start=now.date().isoformat())


def sync(client, org, project_number, status_update, now):
    project = client.query(PROJECT_QUERY, org=org, number=project_number)["organization"]["projectV2"]
    if project is None:
        raise GraphQLError("project %s/%d not found, or the token cannot see it" % (org, project_number))
    project_id = project["id"]
    fields = {f["name"]: f for f in project["fields"]["nodes"] if f.get("name")}
    for name in (TIER, KIND, PROGRESS, SUBS_DONE):
        if name not in fields:
            raise GraphQLError("the board has no field named %r (docs/roadmap-board.md)" % name)

    issues = read_issues(client, now)
    read_sub_issues(client, issues)
    lookup = dict(read_ancestors(client, issues))
    lookup.update(issues)
    items = read_items(client, org, project_number)
    ensure_area_options(client, project_id, fields, issues.values())
    ensure_date_fields(client, project_id, fields)

    counts = {"added": 0, "changed": 0, "unchanged": 0, "skipped": 0}
    deferred = 0
    for number in sorted(issues):
        issue = issues[number]
        item = items.get(number)
        if item is not None and item["archived"]:
            counts["skipped"] += 1
            continue
        if item is None:
            if not should_add(issue):
                continue
            if not client.budget_left():
                deferred += 1
                counts["skipped"] += 1
                continue
            data = client.mutate("add #%d %s" % (number, issue["title"]), ADD_ITEM,
                                 project=project_id, content=issue["id"])
            item = {"id": data and data["addProjectV2ItemById"]["item"]["id"], "values": {}}
            counts["added"] += 1
        changes = [
            (f, v)
            for f, v in field_changes(desired_fields(issue, lookup, now), item["values"])
            if f in fields
        ]
        if not changes:
            counts["unchanged"] += 1
            continue
        if not client.budget_left():
            deferred += 1
            counts["skipped"] += 1
            continue
        for field_name, value in changes:
            if not client.budget_left():
                break
            write_field(client, project_id, item["id"], fields, number, field_name, value)
        counts["changed"] += 1

    # On the board but outside the read window: left exactly as they are.
    counts["skipped"] += sum(1 for n in items if n not in issues)

    if status_update:
        maybe_post_status_update(client, project_id, project["statusUpdates"]["nodes"], lookup, now)

    if deferred:
        print("write budget of %d reached: %d issues continue on the next run" % (MAX_MUTATIONS, deferred))
    print(gaps_line(list(lookup.values())))
    print(summary_line(counts) + (" (dry run)" if client.dry_run else ""))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Sync the GitHub Projects roadmap board (#1348).")
    parser.add_argument("--org", required=True)
    parser.add_argument("--project", type=int, required=True)
    parser.add_argument("--dry-run", action="store_true", help="print the planned changes, write nothing")
    parser.add_argument("--status-update", action="store_true",
                        help="post a weekly status update unless one is under 6 days old")
    args = parser.parse_args(argv)
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        print("sync-roadmap: set GH_TOKEN or GITHUB_TOKEN", file=sys.stderr)
        return 2
    client = Client(token, args.dry_run)
    try:
        sync(client, args.org, args.project, args.status_update, dt.datetime.now(dt.timezone.utc))
    except GraphQLError as error:
        print("sync-roadmap: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
