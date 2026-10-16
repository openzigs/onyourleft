#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/sync-roadmap.py (#1348): the pure decisions, and one sync
# against an in-memory GitHub that records what was written and is read back.
#
# Run: python3 -I scripts/sync-roadmap.test.py
# CI runs it from scripts/check-repo-rules.test.sh, inside the required check.

import datetime as dt
import importlib.util
import io
import os
import sys
import unittest
from contextlib import redirect_stdout

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync-roadmap.py")
_SPEC = importlib.util.spec_from_file_location("sync_roadmap", _PATH)
sr = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(sr)

NOW = dt.datetime(2026, 10, 14, 4, 0, tzinfo=dt.timezone.utc)


def issue(number, labels=(), title="A thing", state="OPEN", parent=None, summary=None, closed=None,
          created="2026-09-01T12:00:00Z"):
    return {
        "id": "I_%d" % number,
        "number": number,
        "title": title,
        "state": state,
        "createdAt": created,
        "closedAt": closed,
        "labels": list(labels),
        "parent": parent,
        "summary": summary,
    }


class Tier(unittest.TestCase):
    def test_each_label(self):
        for label, tier in (
            ("priority: now", "Now"),
            ("priority: next", "Next"),
            ("priority: later", "Later"),
            ("priority: high", "Device check"),
        ):
            self.assertEqual(sr.resolve_tier(1, {1: issue(1, [label])}), tier)

    def test_none_is_unranked(self):
        self.assertEqual(sr.resolve_tier(1, {1: issue(1, ["bug"])}), "Unranked")

    def test_several_takes_the_highest(self):
        labels = ["priority: high", "priority: later", "priority: next"]
        self.assertEqual(sr.resolve_tier(1, {1: issue(1, labels)}), "Next")
        self.assertEqual(sr.resolve_tier(1, {1: issue(1, labels + ["priority: now"])}), "Now")

    def test_inherited_from_the_nearest_ancestor(self):
        issues = {
            1: issue(1, ["epic", "priority: later"]),
            2: issue(2, ["priority: next"], parent=1),
            3: issue(3, parent=2),
            4: issue(4, parent=3),
        }
        self.assertEqual(sr.resolve_tier(4, issues), "Next")
        self.assertEqual(sr.resolve_tier(2, issues), "Next")

    def test_own_label_beats_the_ancestor(self):
        issues = {1: issue(1, ["priority: now"]), 2: issue(2, ["priority: later"], parent=1)}
        self.assertEqual(sr.resolve_tier(2, issues), "Later")

    def test_unknown_parent_and_cycle_end_unranked(self):
        self.assertEqual(sr.resolve_tier(2, {2: issue(2, parent=99)}), "Unranked")
        self.assertEqual(sr.resolve_tier(1, {1: issue(1, parent=2), 2: issue(2, parent=1)}), "Unranked")


class Kind(unittest.TestCase):
    def test_kinds_and_precedence(self):
        self.assertEqual(sr.kind_of(issue(1, ["epic", "bug"], title="Spike: x")), "Epic")
        self.assertEqual(sr.kind_of(issue(1, ["bug"], title="Spike: x")), "Spike")
        self.assertEqual(sr.kind_of(issue(1, ["bug"], title="Crash")), "Bug")
        self.assertEqual(sr.kind_of(issue(1, ["infra"], title="Thing")), "Issue")


class Area(unittest.TestCase):
    def test_area_label(self):
        self.assertEqual(sr.area_of(["infra", "area: racing"]), "racing")
        self.assertIsNone(sr.area_of(["infra", "area:"]))
        self.assertEqual(sr.area_of(["area: sync", "area: racing"]), "racing")

    def test_missing_options(self):
        issues = [issue(1, ["area: racing"]), issue(2, ["area: sync"]), issue(3)]
        self.assertEqual(sr.missing_area_options(issues, ["sync"]), ["racing"])
        self.assertEqual(sr.missing_area_options(issues, ["sync", "racing"]), [])


class Progress(unittest.TestCase):
    def test_with_sub_issues(self):
        summary = {"total": 23, "completed": 10, "percentCompleted": 43}
        self.assertEqual(sr.progress_of(summary), (43, "10 of 23"))

    def test_without_sub_issues_clears(self):
        self.assertEqual(sr.progress_of({"total": 0, "completed": 0, "percentCompleted": 0}), (None, None))
        self.assertEqual(sr.progress_of(None), (None, None))


def sub(state="OPEN", created="2026-09-01T12:00:00Z", closed=None):
    return {"createdAt": created, "closedAt": closed, "state": state}


def epic(state="OPEN", created="2026-09-01T12:00:00Z", closed=None, subs=()):
    e = issue(1, ["epic"], state=state, created=created, closed=closed)
    e["subs"] = list(subs)
    return e


# NOW is 2026-10-14; 28 days before is 2026-09-16, 90 days before is 2026-07-16.
RECENT = "2026-10-01T00:00:00Z"  # inside 28 days
OLDER = "2026-08-01T00:00:00Z"  # inside 90, outside 28
ANCIENT = "2026-06-01T00:00:00Z"  # outside 90


class Start(unittest.TestCase):
    def test_earliest_sub_issue(self):
        e = epic(created="2026-09-10T00:00:00Z", subs=[sub(created="2026-09-20T00:00:00Z"),
                                                       sub(created="2026-08-05T23:59:00Z")])
        self.assertEqual(sr.start_of(e), "2026-08-05")

    def test_epic_earlier_or_no_sub_issues(self):
        e = epic(created="2026-07-01T00:00:00Z", subs=[sub(created="2026-09-20T00:00:00Z")])
        self.assertEqual(sr.start_of(e), "2026-07-01")
        self.assertEqual(sr.start_of(epic(created="2026-07-02T00:00:00Z")), "2026-07-02")


class Target(unittest.TestCase):
    def test_closed_epic_is_its_close(self):
        e = epic(state="CLOSED", closed="2026-09-30T18:00:00Z", subs=[sub()])
        self.assertEqual(sr.target_of(e, NOW), "2026-09-30")

    def test_no_open_sub_issues_is_today(self):
        self.assertEqual(sr.target_of(epic(), NOW), "2026-10-14")
        self.assertEqual(sr.target_of(epic(subs=[sub("CLOSED", closed=ANCIENT)]), NOW), "2026-10-14")

    def test_pace_from_the_last_28_days(self):
        # 2 closed in 28 days: 0.5 a week. 3 open: ceil(6) = 6 weeks.
        subs = [sub("CLOSED", closed=RECENT)] * 2 + [sub("CLOSED", closed=OLDER)] * 5 + [sub()] * 3
        self.assertEqual(sr.target_of(epic(subs=subs), NOW), "2026-11-25")
        # 3 closed in 28 days: 0.75 a week. 4 open: ceil(5.33) = 6 weeks.
        subs = [sub("CLOSED", closed=RECENT)] * 3 + [sub()] * 4
        self.assertEqual(sr.target_of(epic(subs=subs), NOW), "2026-11-25")
        # 8 closed: 2 a week. 4 open: exactly 2 weeks, no rounding up.
        subs = [sub("CLOSED", closed=RECENT)] * 8 + [sub()] * 4
        self.assertEqual(sr.target_of(epic(subs=subs), NOW), "2026-10-28")
        # A reopened sub-issue is open work, not a close, whatever its closedAt says.
        subs = [sub("CLOSED", closed=RECENT)] * 2 + [sub(closed=RECENT)] * 2 + [sub()]
        self.assertEqual(sr.target_of(epic(subs=subs), NOW), "2026-11-25")

    def test_fallback_to_the_last_90_days(self):
        # 9 closed in 90 days, none in 28: 0.7 a week. 2 open: ceil(2.857) = 3 weeks.
        subs = [sub("CLOSED", closed=OLDER)] * 9 + [sub("CLOSED", closed=ANCIENT)] * 20 + [sub()] * 2
        self.assertEqual(sr.target_of(epic(subs=subs), NOW), "2026-11-04")

    def test_no_progress_in_90_days_clears(self):
        subs = [sub("CLOSED", closed=ANCIENT)] * 5 + [sub()]
        self.assertIsNone(sr.target_of(epic(subs=subs), NOW))

    def test_capped_at_two_years(self):
        subs = [sub("CLOSED", closed=OLDER)] + [sub()] * 200
        self.assertEqual(sr.target_of(epic(subs=subs), NOW), "2028-10-13")

    def test_no_recent_progress_section(self):
        stalled = epic(subs=[sub("CLOSED", closed=ANCIENT), sub()])
        stalled["title"] = "Stalled epic"
        moving = issue(2, ["epic"], title="Moving epic")
        moving["subs"] = [sub("CLOSED", closed=RECENT), sub()]
        issues = [stalled, moving, issue(3, ["epic"], state="CLOSED", closed=RECENT)]
        self.assertEqual([i["number"] for i in sr.no_recent_progress(issues, NOW)], [1])
        body = sr.status_update_body(issues, NOW)
        self.assertIn("No recent progress: no sub-issue closed in 90 days, so no Target (1)", body)
        self.assertIn("#1 Stalled epic", body)
        self.assertNotIn("No recent progress", sr.status_update_body([moving], NOW))

    def test_dates_only_on_epics(self):
        lookup = {1: issue(1, ["bug"])}
        self.assertNotIn("Start", sr.desired_fields(lookup[1], lookup, NOW))
        self.assertEqual(sr.field_changes(sr.desired_fields(lookup[1], lookup, NOW),
                                          {"Tier": "Unranked", "Kind": "Bug", "Start": "2026-01-01"}), [])
        e = epic(subs=[sub()])
        desired = sr.desired_fields(e, {1: e}, NOW)
        self.assertEqual((desired["Start"], desired["Target"]), ("2026-09-01", None))


class Changes(unittest.TestCase):
    def test_only_what_differs(self):
        desired = {"Tier": "Now", "Kind": "Epic", "Area": "racing", "Progress %": 43, "Sub-issues done": "10 of 23"}
        current = {"Tier": "Now", "Kind": "Issue", "Area": "racing", "Progress %": 43.0, "Sub-issues done": "9 of 23"}
        self.assertEqual(sr.field_changes(desired, current), [("Kind", "Epic"), ("Sub-issues done", "10 of 23")])

    def test_clear_and_unchanged_clear(self):
        desired = {"Tier": "Unranked", "Kind": "Issue", "Area": None, "Progress %": None, "Sub-issues done": None}
        self.assertEqual(
            sr.field_changes(desired, {"Tier": "Unranked", "Kind": "Issue", "Progress %": 50.0}),
            [("Progress %", None)],
        )

    def test_status_is_never_a_change(self):
        desired = {"Tier": "Now", "Kind": "Issue", "Area": None, "Progress %": None, "Sub-issues done": None}
        changes = sr.field_changes(desired, {"Tier": "Now", "Kind": "Issue", "Status": "Done"})
        self.assertEqual(changes, [])
        self.assertNotIn("Status", sr.MANAGED_FIELDS)


class Window(unittest.TestCase):
    def test_add_and_window(self):
        old = "2026-08-01T00:00:00Z"
        recent = "2026-10-10T00:00:00Z"
        self.assertTrue(sr.should_add(issue(1)))
        self.assertTrue(sr.should_add(issue(1, ["epic"], state="CLOSED", closed=old)))
        self.assertFalse(sr.should_add(issue(1, state="CLOSED", closed=recent)))
        self.assertTrue(sr.in_read_window(issue(1, state="CLOSED", closed=recent), NOW))
        self.assertFalse(sr.in_read_window(issue(1, state="CLOSED", closed=old), NOW))
        self.assertTrue(sr.in_read_window(issue(1, ["epic"], state="CLOSED", closed=old), NOW))


class StatusUpdate(unittest.TestCase):
    def test_due(self):
        self.assertTrue(sr.status_update_due(None, NOW))
        self.assertFalse(sr.status_update_due("2026-10-09T00:00:00Z", NOW))
        self.assertTrue(sr.status_update_due("2026-10-08T03:00:00Z", NOW))

    def test_status_carries_forward(self):
        self.assertEqual(sr.status_update_status(None), "ON_TRACK")
        self.assertEqual(sr.status_update_status("AT_RISK"), "AT_RISK")

    def test_body(self):
        issues = [
            issue(5, title="Closed this week", state="CLOSED", closed="2026-10-12T00:00:00Z"),
            issue(6, title="Closed last month", state="CLOSED", closed="2026-09-01T00:00:00Z"),
            issue(7, ["priority: now", "area: racing"], title="Doing now"),
            issue(8, ["priority: next", "area: racing"], title="Doing next"),
        ]
        body = sr.status_update_body(issues, NOW)
        self.assertIn("#5 Closed this week", body)
        self.assertNotIn("#6", body)
        self.assertIn("#7 Doing now", body)
        self.assertNotIn("#8", body)

    def test_label_gaps(self):
        issues = [
            issue(1, ["epic", "priority: next", "area: racing"]),
            issue(2, ["area: racing"], parent=1),
            issue(3, ["priority: later"]),
            issue(4, ["area: sync"]),
            issue(5, [], state="CLOSED", closed="2026-10-12T00:00:00Z"),
        ]
        no_area, unranked = sr.label_gaps(issues)
        self.assertEqual([i["number"] for i in no_area], [3])
        self.assertEqual([i["number"] for i in unranked], [4])
        body = sr.status_update_body(issues, NOW)
        self.assertIn("Needs an `area:` label (1)", body)
        self.assertIn("Unranked: no `priority:` label, own or its epic's (1)", body)
        self.assertIn("labels: 1 open without an area, 1 unranked", sr.gaps_line(issues))

    def test_no_gaps_no_section(self):
        issues = [issue(1, ["priority: now", "area: racing"])]
        self.assertEqual(sr.label_gaps(issues), ([], []))
        self.assertNotIn("Needs", sr.status_update_body(issues, NOW))
        self.assertNotIn("Unranked", sr.status_update_body(issues, NOW))

    def test_body_caps_the_list(self):
        issues = [issue(n, ["priority: now"]) for n in range(sr.STATUS_LIST_CAP + 3)]
        self.assertIn("and 3 more", sr.status_update_body(issues, NOW))


FIELD_NAMES = {"F_tier": "Tier", "F_kind": "Kind", "F_pct": "Progress %", "F_done": "Sub-issues done",
               "F_area": "Area", "F_status": "Status", "F_start": "Start", "F_target": "Target"}


class FakeClient(sr.Client):
    """An in-memory board behind the real Client's query and mutate."""

    def __init__(self, issues, items=None, dry_run=False, area_options=None, updates=None, date_fields=()):
        super().__init__("not-a-token", dry_run)
        self.issues = issues
        self.date_fields = dict(date_fields)  # name -> dataType
        self.board = items or {}  # number -> {"id", "archived", "values"}
        self.area_options = area_options
        self.updates = updates or []
        self.posted = []
        self.writes = []

    def _post(self, query, variables):
        if query is sr.PROJECT_QUERY:
            fields = [
                {"id": "F_tier", "name": "Tier", "dataType": "SINGLE_SELECT",
                 "options": [{"id": "o_" + n, "name": n} for n in ("Now", "Next", "Later", "Device check", "Unranked")]},
                {"id": "F_kind", "name": "Kind", "dataType": "SINGLE_SELECT",
                 "options": [{"id": "o_" + n, "name": n} for n in ("Epic", "Issue", "Spike", "Bug")]},
                {"id": "F_pct", "name": "Progress %", "dataType": "NUMBER"},
                {"id": "F_done", "name": "Sub-issues done", "dataType": "TEXT"},
                {"id": "F_status", "name": "Status", "dataType": "SINGLE_SELECT", "options": []},
            ]
            for name, data_type in self.date_fields.items():
                fields.append({"id": "F_" + name.lower(), "name": name, "dataType": data_type})
            if self.area_options is not None:
                fields.append({"id": "F_area", "name": "Area", "dataType": "SINGLE_SELECT",
                               "options": [{"id": "o_" + n, "name": n} for n in self.area_options]})
            return {"organization": {"projectV2": {"id": "P", "fields": {"nodes": fields},
                                                   "statusUpdates": {"nodes": self.updates}}}}
        if query is sr.ISSUES_QUERY:
            f = variables["filter"]
            nodes = [
                i for i in self.issues.values()
                if i["state"] in f["states"] and all(label in i["labels"] for label in f.get("labels", []))
            ]
            return {"repository": {"issues": {"pageInfo": {"hasNextPage": False, "endCursor": None},
                                              "nodes": [self._node(i) for i in nodes]}}}
        if query is sr.SUB_ISSUES_QUERY:
            subs = [{"createdAt": i["createdAt"], "closedAt": i["closedAt"], "state": i["state"]}
                    for i in self.issues.values() if i["parent"] == variables["number"]]
            # Two to a page, so the paging is exercised.
            start = int(variables["after"] or 0)
            more = start + 2 < len(subs)
            return {"repository": {"issue": {"subIssues": {
                "pageInfo": {"hasNextPage": more, "endCursor": str(start + 2) if more else None},
                "nodes": subs[start:start + 2]}}}}
        if query is sr.ONE_ISSUE_QUERY:
            return {"repository": {"issue": None}}
        if query is sr.ITEMS_QUERY:
            names = FIELD_NAMES
            nodes = []
            for number, item in self.board.items():
                values = []
                for field, value in item["values"].items():
                    key = {"Progress %": "number", "Sub-issues done": "text", "Start": "date",
                           "Target": "date"}.get(field, "name")
                    values.append({key: value, "field": {"name": field}})
                assert set(names.values()) >= set(item["values"])
                nodes.append({"id": item["id"], "isArchived": item.get("archived", False),
                              "content": {"number": number, "repository": {"nameWithOwner": "openzigs/onyourleft"}},
                              "fieldValues": {"nodes": values}})
            return {"organization": {"projectV2": {"items": {
                "pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": nodes}}}}
        self.writes.append((query, variables))
        if query is sr.ADD_ITEM:
            number = int(variables["content"].split("_")[1])
            item = self.board.setdefault(number, {"id": "PVTI_%d" % number, "values": {}})
            return {"addProjectV2ItemById": {"item": {"id": item["id"]}}}
        if query in (sr.SET_VALUE, sr.CLEAR_VALUE):
            item = next(i for i in self.board.values() if i["id"] == variables["item"])
            field = FIELD_NAMES[variables["field"]]
            if query is sr.CLEAR_VALUE:
                item["values"].pop(field, None)
            else:
                value = variables["value"]
                if "singleSelectOptionId" in value:
                    item["values"][field] = value["singleSelectOptionId"][2:]
                else:
                    item["values"][field] = value.get("number", value.get("text", value.get("date")))
            return {}
        if query is sr.CREATE_FIELD:
            self.area_options = [o["name"] for o in variables["options"]]
            return {"createProjectV2Field": {"projectV2Field": {
                "id": "F_area", "name": "Area", "options": [{"id": "o_" + n, "name": n} for n in self.area_options]}}}
        if query is sr.CREATE_DATE_FIELD:
            self.date_fields[variables["name"]] = "DATE"
            return {"createProjectV2Field": {"projectV2Field": {
                "id": "F_" + variables["name"].lower(), "name": variables["name"]}}}
        if query is sr.UPDATE_FIELD:
            self.area_options = [o["name"] for o in variables["options"]]
            self.update_field_inputs = variables["options"]
            return {"updateProjectV2Field": {"projectV2Field": {
                "id": "F_area", "name": "Area", "options": [{"id": "o_" + n, "name": n} for n in self.area_options]}}}
        if query is sr.STATUS_UPDATE:
            self.posted.append(variables)
            return {}
        raise AssertionError("unexpected query")

    @staticmethod
    def _node(i):
        return {"id": i["id"], "number": i["number"], "title": i["title"], "state": i["state"],
                "createdAt": i["createdAt"], "closedAt": i["closedAt"], "labels": {"nodes": [{"name": n} for n in i["labels"]]},
                "parent": {"number": i["parent"]} if i["parent"] else None, "subIssuesSummary": i["summary"]}


def run(client, status_update=False):
    sr.MUTATION_INTERVAL_S = 0
    client.mutations = 0  # each night is a fresh process with a fresh budget
    out = io.StringIO()
    with redirect_stdout(out):
        sr.sync(client, "openzigs", 1, status_update, NOW)
    return out.getvalue()


def corpus():
    return {
        16: issue(16, ["epic", "priority: now", "area: racing"], summary={"total": 23, "completed": 10, "percentCompleted": 43}),
        785: issue(785, ["area: racing"], parent=16, created="2026-09-20T00:00:00Z"),
        786: issue(786, ["area: racing"], parent=16, state="CLOSED", closed="2026-10-01T00:00:00Z",
                   created="2026-08-30T08:00:00Z"),
        787: issue(787, ["area: racing"], parent=16, state="CLOSED", closed="2026-10-02T00:00:00Z"),
        900: issue(900, ["bug"], state="CLOSED", closed="2026-10-12T00:00:00Z"),
        901: issue(901, ["epic"], state="CLOSED", closed="2026-01-01T00:00:00Z", created="2025-11-01T00:00:00Z"),
    }


class Sync(unittest.TestCase):
    def test_first_run_fills_the_board_and_the_second_changes_nothing(self):
        client = FakeClient(corpus())
        out = run(client)
        # Read back through the board's own read path, not the write log.
        items = sr.read_items(client, "openzigs", 1)
        self.assertEqual(sorted(items), [16, 785, 901])  # a closed non-epic is not added
        # #16's sub-issues: #786 is the earliest created; 2 closed in 28 days and
        # 1 open is 0.5 a week, so 2 weeks from 2026-10-14.
        self.assertEqual(items[16]["values"], {"Tier": "Now", "Kind": "Epic", "Area": "racing",
                                               "Progress %": 43.0, "Sub-issues done": "10 of 23",
                                               "Start": "2026-08-30", "Target": "2026-10-28"})
        self.assertEqual(items[785]["values"], {"Tier": "Now", "Kind": "Issue", "Area": "racing"})
        self.assertEqual(items[901]["values"], {"Tier": "Unranked", "Kind": "Epic",
                                                "Start": "2025-11-01", "Target": "2026-01-01"})
        self.assertEqual(client.area_options, ["racing"])
        self.assertEqual(client.date_fields, {"Start": "DATE", "Target": "DATE"})
        self.assertIn("summary: added 3, changed 3, unchanged 0, skipped 0", out)

        client.writes.clear()
        out = run(client)
        self.assertEqual(client.writes, [])
        self.assertIn("summary: added 0, changed 0, unchanged 3, skipped 0", out)

    def test_existing_date_fields_are_reused_and_a_wrong_type_is_not_written(self):
        client = FakeClient(corpus(), area_options=["racing"], date_fields={"Start": "DATE", "Target": "TEXT"})
        out = run(client)
        self.assertFalse(any(q is sr.CREATE_DATE_FIELD for q, _ in client.writes))
        self.assertIn("skip Target: the board's field of that name is TEXT, not DATE", out)
        self.assertEqual(client.board[16]["values"]["Start"], "2026-08-30")
        self.assertNotIn("Target", client.board[16]["values"])

    def test_a_stalled_epic_has_its_target_cleared(self):
        issues = corpus()
        issues[786]["closedAt"] = issues[787]["closedAt"] = "2026-06-01T00:00:00Z"
        board = {16: {"id": "PVTI_16", "values": {"Target": "2026-12-01"}}}
        client = FakeClient(issues, items=board, area_options=["racing"], date_fields={"Start": "DATE", "Target": "DATE"})
        run(client)
        self.assertNotIn("Target", client.board[16]["values"])
        self.assertEqual(client.board[16]["values"]["Start"], "2026-08-30")

    def test_dry_run_writes_nothing(self):
        client = FakeClient(corpus(), dry_run=True)
        out = run(client, status_update=True)
        self.assertEqual(client.writes, [])
        self.assertEqual(client.board, {})
        self.assertIn("would add #16", out)
        self.assertIn("would set #785 Tier -> Now", out)
        self.assertIn("would create date field Start", out)
        self.assertIn("would set #16 Target -> 2026-10-28", out)
        self.assertIn("would post status update", out)

    def test_status_and_archived_items_are_left_alone(self):
        board = {
            785: {"id": "PVTI_785", "values": {"Status": "Done", "Tier": "Later"}},
            16: {"id": "PVTI_16", "archived": True, "values": {"Tier": "Later"}},
            5: {"id": "PVTI_5", "values": {"Tier": "Later"}},  # outside the read window
        }
        client = FakeClient(corpus(), items=board, area_options=["racing"])
        out = run(client)
        self.assertEqual(client.board[785]["values"]["Status"], "Done")
        self.assertEqual(client.board[785]["values"]["Tier"], "Now")
        self.assertEqual(client.board[16]["values"], {"Tier": "Later"})
        self.assertEqual(client.board[5]["values"], {"Tier": "Later"})
        self.assertFalse(any(v.get("field") == "F_status" for _, v in client.writes))
        self.assertIn("skipped 2", out)

    def test_new_area_label_keeps_existing_option_ids(self):
        client = FakeClient(corpus(), area_options=["sync"])
        run(client)
        self.assertEqual(client.area_options, ["sync", "racing"])
        self.assertEqual(client.update_field_inputs[0]["id"], "o_sync")

    def test_budget_caps_the_run_and_the_next_run_continues(self):
        saved = sr.MAX_MUTATIONS
        sr.MAX_MUTATIONS = 4
        try:
            client = FakeClient(corpus(), area_options=["racing"])
            out = run(client)
            self.assertEqual(len(client.writes), 4)
            self.assertIn("continue on the next run", out)
            for _ in range(5):
                run(client)
        finally:
            sr.MAX_MUTATIONS = saved
        self.assertEqual(client.board[785]["values"].get("Tier"), "Now")
        self.assertEqual(sorted(client.board), [16, 785, 901])

    def test_status_update_posted_once_a_week(self):
        client = FakeClient(corpus(), area_options=["racing"],
                            updates=[{"createdAt": "2026-10-10T00:00:00Z", "status": "AT_RISK"}])
        out = run(client, status_update=True)
        self.assertEqual(client.posted, [])
        self.assertIn("status update: skipped", out)
        client.updates = [{"createdAt": "2026-10-01T00:00:00Z", "status": "AT_RISK"}]
        run(client, status_update=True)
        self.assertEqual(len(client.posted), 1)
        self.assertEqual(client.posted[0]["status"], "AT_RISK")
        self.assertIn("#900", client.posted[0]["body"])

    def test_no_status_update_without_the_flag(self):
        client = FakeClient(corpus(), area_options=["racing"])
        run(client)
        self.assertEqual(client.posted, [])


class Token(unittest.TestCase):
    def test_missing_token_is_refused(self):
        saved = {k: os.environ.pop(k, None) for k in ("GH_TOKEN", "GITHUB_TOKEN")}
        try:
            err = io.StringIO()
            from contextlib import redirect_stderr
            with redirect_stderr(err):
                self.assertEqual(sr.main(["--org", "o", "--project", "1"]), 2)
            self.assertIn("GH_TOKEN", err.getvalue())
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v

    def test_an_http_error_never_carries_the_token(self):
        import urllib.error
        import urllib.request

        secret = "ghs_secretvalue123"

        def fail(request, timeout):
            raise urllib.error.HTTPError(sr.API_URL, 401, "Unauthorized", {}, io.BytesIO(b'{"message":"Bad credentials"}'))

        saved = urllib.request.urlopen
        urllib.request.urlopen = fail
        try:
            with self.assertRaises(sr.GraphQLError) as caught:
                sr.Client(secret, False).query("query{viewer{login}}")
        finally:
            urllib.request.urlopen = saved
        self.assertIn("401 Bad credentials", str(caught.exception))
        self.assertNotIn(secret, str(caught.exception))


if __name__ == "__main__":
    unittest.main(verbosity=1)
