# Spike 0019: the UK Online Safety Act and the EU Digital Services Act, read first-hand for the project's own instance

- **Date read**: **2026-09-30.** Every source in §1 was read on that day, and each row says how.
  The repository was read on `origin/main` the same day.
- **Issues**: [#886](https://github.com/openzigs/onyourleft/issues/886) (the Online Safety Act
  assessments) and [#887](https://github.com/openzigs/onyourleft/issues/887) (DSA Art. 16
  notice-and-action). Epic [#16](https://github.com/openzigs/onyourleft/issues/16). Public rooms
  ([#788](https://github.com/openzigs/onyourleft/issues/788)) are blocked on both.
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest
  on, and it ages the way a measurement does."* This one is a **reading** of legislation, a
  regulation and a regulator's codes and guidance. ⚠️ **It is not legal advice, and no lawyer has
  checked it.** Every point marked **OPEN** is for the owner or a lawyer.
- **Who read it**: a research agent, on the owner's instruction of 2026-09-30. The drafts it feeds
  are in [`docs/moderation/`](../moderation/illegal-content-risk-assessment.md), and each of them is
  a draft pending the owner's approval.
- **Why 0019**: `docs/spikes/` holds 0001–0008 and 0010–0018 on `main`. 0009 is claimed by
  [#471](https://github.com/openzigs/onyourleft/pull/471), still open. No other open pull request
  adds a spike (checked with `git ls-tree` on every open pull request's branch on 2026-09-30).

> ## ⚠️ What this reading found, in one paragraph
>
> **The UK Act has no size, revenue or commercial threshold**, and no Schedule 1 exemption fits an
> instance whose user-generated content is display names, routes shown in group rides and race
> results. An **18+ tick box cannot support the conclusion that children cannot access the
> service**: s.35(2) requires age verification or estimation, and s.230(4) says self-declaration
> *"(without more)"* is neither. So the children's access assessment goes to its second stage.
> **Two duties that #886 does not mention are in force**: the intimate image content report with a
> 48-hour takedown (s.20A and s.10(3A), from 29.6.2026) and CSEA reporting to the NCA (s.66, from
> 7.4.2026). **Whether the EU Regulation reaches a free, non-commercial service run by one private
> individual is not answered by any text read**: it turns on "normally provided for remuneration"
> and "economic activity". If it does apply, Arts 11–14 and 16–18 carry **no** micro or small
> exemption, and Art. 13 requires a legal representative in a Member State for a provider with no
> EU establishment. #887's "named deputy" is superseded by
> [#905](https://github.com/openzigs/onyourleft/issues/905) (one moderator, 2026-09-30).

**Method.**
- legislation.gov.uk: sections fetched raw with `curl` and stripped of HTML locally. The text quoted is the page's "Latest available (Revised)" version. The Schedule 1 Part 1 page states: *"up to date with all changes known to be in force on or before 30 September 2026. There are changes that may be brought into force at a future date."*
- Ofcom PDFs and EUR-Lex: Ofcom returns `403` and EUR-Lex returns `202` with an empty body to `curl`/WebFetch, so the full text was pulled with **Tavily extract** and searched locally. The reader counted Tavily's raw extraction as a first-hand read of the document text, but it is machine extraction: tables lose their layout, and footnote numbers are sometimes glued onto words.
- Repository: read on `origin/main`. Issues: read with `gh issue view`.
- The reading itself wrote nothing to the repository. This file is its record, committed with the drafts it feeds.

---

## 1. Source table

| # | URL | What was read | Date read | First-hand? | Full / part |
|---|---|---|---|---|---|
| L1 | https://www.legislation.gov.uk/ukpga/2023/50/section/3 | OSA s.3 (user-to-user service) | 2026-09-30 | Yes (curl) | (1)–(4) in full; (5)–(7) in part |
| L2 | …/section/4 | s.4 (regulated services, links with the UK) | 2026-09-30 | Yes | Full |
| L3 | …/schedule/1/part/1 | Sch.1 Pt 1, exemptions paras 1–11 | 2026-09-30 | Yes | Paras 1–9 and 11 in full; para 10 in part |
| L4 | …/section/9 | Illegal content risk assessment duties | 2026-09-30 | Yes | Full |
| L5 | …/section/10 | Illegal content safety duties, as amended 29.6.2026 | 2026-09-30 | Yes | Full |
| L6 | …/section/20 and …/section/20A | Content reporting; intimate image content report (inserted 29.6.2026) | 2026-09-30 | Yes | Full |
| L7 | …/section/21 | Complaints procedures | 2026-09-30 | Yes | Full |
| L8 | …/section/23 | Record-keeping and review | 2026-09-30 | Yes | Full |
| L9 | …/section/35, /36, /37 | Children's access assessments | 2026-09-30 | Yes | Full |
| L10 | …/section/55 | User-generated content, regulated UGC | 2026-09-30 | Yes | Full |
| L11 | …/section/226, /227, /230, /236 | Provider; UK user; age verification and self-declaration; "content", "encounter", "identifying content" | 2026-09-30 | Yes | 226(1)–(11), 227 and 230 in full; 236 the definitions quoted only |
| L12 | …/schedule/3/part/1 | Timing of the first assessments | 2026-09-30 | Yes | Full |
| L13 | …/section/66 | Reporting CSEA to the NCA | 2026-09-30 | Yes | Full |
| O1 | https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/detecting-intimate-image-abuse/illegal-content-codes-of-practice-for-user-to-user-services-9sep2026.pdf | Illegal content Codes of Practice for U2U services. Cover: "Incorporates amendments issued: 9 September 2026 Incorporates amendments in force: 30 September 2026" | 2026-09-30 | Yes (Tavily extract; curl and WebFetch got 403) | Index in full; measures A2, A3–A7, C1–C8, D1, D2, D7–D13, G1, G3, H1 and the definitions in §5 read; the rest searched, not read line by line |
| O2 | https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/check-how-to-comply-with-the-illegal-content-rules | Ofcom page (published 16 Dec 2024, updated 24 Feb 2025) | 2026-09-30 | Yes | Full |
| O3 | https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/helping-small-services-navigate-the-online-safety-act | Ofcom small-services page | 2026-09-30 | Yes | **Part**: the bullet list after "These include:" did not come through the extraction |
| O4 | https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/childrens-access-assessment-duties-under-the-online-safety-act | CAA duties page (published 7 May 2024, updated 29 June 2026) | 2026-09-30 | Yes | Full |
| O5 | https://www.ofcom.org.uk/os-toolkit/child-access-assessment/childrens-access-assessment-tool | Ofcom CAA toolkit page | 2026-09-30 | Yes | Part (searched for self-declaration and "significant number") |
| O6 | https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-age-assurance-and-childrens-access/part-3-guidance-on-highly-effective-age-assurance.pdf?v=395680 | Part 3 HEAA Guidance ("Published 24 April 2025") | 2026-09-30 | Yes (Tavily) | Part (§2 and §3.14–3.16) |
| O7 | https://www.ofcom.org.uk/online-safety/protecting-children/age-assurance | Ofcom age assurance page | 2026-09-30 | Yes | Full |
| O8 | https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/important-dates-for-online-safety-compliance | Ofcom dates table | 2026-09-30 | Yes | Part (searched by date) |
| O9 | https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/risk-assessment-guidance-and-risk-profiles.pdf (no `?v=`) | Risk Assessment Guidance and Risk Profiles. ⚠️ **The document returned is headed "Published 16 December 2024"**, while Ofcom's documents page lists an **"Updated" version dated 25 June 2026** | 2026-09-30 | Yes (Tavily) | Part (four steps, risk-level tables, Table 8, some risk factors). **Possibly the superseded version.** |
| O10 | https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/statement-protecting-people-from-illegal-harms-online | Update log: codes issued 24 Feb 2025, and later updates | 2026-09-30 | Search snippet only | Part |
| O11 | https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/online-safety-regulatory-documents | Document list with dates | 2026-09-30 | Search snippet only | Part |
| E1 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065 | DSA as published in OJ L 277, 27.10.2022 | 2026-09-30 | Yes (Tavily; curl got 202 and an empty body) | Arts 2, 3, 11–19, 24 and 93, and recitals 5, 7, 8, 13–15, 50, 52, 54 and 57 in full; Arts 20–23 opening lines only |
| E2 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32015L1535 | Directive (EU) 2015/1535, Art. 1(1)(b) | 2026-09-30 | Yes (Tavily) | Art. 1 in part |
| E3 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32003H0361 | Recommendation 2003/361/EC | 2026-09-30 | Yes (Tavily) | Annex Arts 1–3(2) and recitals 3–4 |
| E4 | https://eur-lex.europa.eu/eli/dir/2000/31/oj/eng | Directive 2000/31/EC, recital 18 | 2026-09-30 | Yes (Tavily) | Recital 18 only |
| E5 | https://digital-strategy.ec.europa.eu/en/faqs/dsa-transparency-database-questions-and-answers | Commission FAQ on the Transparency Database ("Last update 7 July 2025") | 2026-09-30 | Yes | Full |
| E6 | https://transparency.dsa.ec.europa.eu/ | Database landing page | 2026-09-30 | Via WebFetch (a summarising model); one sentence quoted | Part |
| R1 | Repository (`origin/main`): `docs/moderation.md`, `docs/operating-an-instance.md`, ADR 0028 D-6, ADR 0036, spike 0018; issues #886, #887, #788, #83, #775, #905 | Grounding | 2026-09-30 | Yes | The parts cited |
| S1 | https://www.osborneclarke.com/system/files/documents/26/09/28/Regulatory-Outlook---September-2026_1.pdf | Search snippet about the EU "KIDS ACT" proposal | 2026-09-30 | **Second-hand; snippet only** | Snippet |

---

## 2. UK: Online Safety Act 2023

### Q1. Is it a user-to-user service? Exemptions, size, and links with the UK

**Quotations**

- s.3(1) [L1]: *"In this Act "user-to-user service" means an internet service by means of which content that is generated directly on the service by a user of the service, or uploaded to or shared on the service by a user of the service, may be encountered by another user, or other users, of the service."*
- s.3(2) [L1]: *"(a) it does not matter if content is actually shared with another user or users as long as a service has a functionality that allows such sharing; (b) it does not matter what proportion of content on a service is content described in that subsection."*
- s.236 [L11]: *""content" means anything communicated by means of an internet service, whether publicly or privately, including written material or messages, oral communications, photographs, videos, visual images, music and data of any description"*; *""encounter", in relation to content, means read, view, hear or otherwise experience content"*; *""identifying content" means content the function of which is to identify a user of an internet service (for example, a user name or profile picture)"*.
- s.4(2) [L2]: *"A user-to-user service is a "regulated user-to-user service" … if the service— (a) has links with the United Kingdom (see subsections (5) and (6)), and (b) is not— (i) a service of a description that is exempt as provided for by Schedule 1, or (ii) a service of a kind described in Schedule 2 …"*
- s.4(5) [L2]: *"… "has links with the United Kingdom" if— (a) the service has a significant number of United Kingdom users, or (b) United Kingdom users form one of the target markets for the service (or the only target market)."*
- s.4(6) [L2]: *"… also "has links with the United Kingdom" if— (a) the service is capable of being used in the United Kingdom by individuals, and (b) there are reasonable grounds to believe that there is a material risk of significant harm to individuals in the United Kingdom presented by— (i) in the case of a user-to-user service, user-generated content present on the service …"*
- s.226(2)–(3) [L11]: *"The provider of a user-to-user service is to be treated as being the entity that has control over who can use the user-to-user part of the service (and that entity alone). (3) If no entity has control over who can use the user-to-user part of a user-to-user service, but an individual or individuals have control over who can use that part, the provider of the service is to be treated as being that individual or those individuals."*
- s.227(1)–(3) [L11]: *"a user is a "United Kingdom user" of a service if— (a) where the user is an individual, the individual is in the United Kingdom"*; *"(2) … it does not matter whether a person is registered to use a service. (3) References in this Act to a user of a service do not include … when acting in the course of the provider's business— (a) where the provider of the service is an individual or individuals, that individual or those individuals"*; s.227(4)(b) reads "business" as *"a business, trade, profession or other concern— (i) carried on (whether or not for profit) by the provider"*.
- Sch.1 para 1 [L3]: *"A user-to-user service is exempt if emails are the only user-generated content (other than identifying content) enabled by the service."* Para 2 does the same for SMS/MMS. Para 3: *"… if one-to-one live aural communications are the only user-generated content (other than identifying content) enabled by the service."*
- Sch.1 para 4(1) [L3], limited functionality: *"… users are able to communicate by means of the service only in the following ways— (a) posting comments or reviews relating to provider content; (b) sharing such comments or reviews on a different internet service; (c) expressing a view on such comments or reviews, or on provider content, by means of— (i) applying a "like" or "dislike" button … (ii) applying an emoji … (iii) engaging in yes/no voting, or (iv) rating or scoring the content … (d) producing or displaying identifying content in connection with any of the activities described in paragraphs (a) to (c)."* Para 4(3): *"content that is user-generated content in relation to a service is not to be regarded as provider content in relation to that service."*
- Sch.1 para 5 [L3] covers combinations of paras 1–4 only.
- Sch.1 para 7(2) [L3], internal business services: *"(a) the user-to-user service or search service is an internal resource or tool for a business … (b) the person carrying on the business … ("P") is the provider … and (c) the … service is available only to a closed group of people comprising some or all of the following— (i) where P is an individual or individuals, that individual or those individuals … (iii) persons who work for P (including as employees or volunteers) for the purposes of any activities of the business … (iv) any other persons authorised by a person within sub-paragraph (i), (ii) or (iii) to use the service for the purposes of any activities of the business …"*. Para 7(3): *""business" includes trade, profession, educational institution or other concern (whether or not carried on for profit)"*.
- Sch.1 para 9 [L3] covers public bodies and para 10 education or childcare; neither is relevant here.
- s.55(4)(b) [L10]: *"a bot or other automated tool is to be regarded as a user of a service if— (i) the functions of the bot or tool include interacting with user-generated content, and (ii) the bot or tool is not controlled by or on behalf of the provider of the service."*
- Ofcom small-services page [O3]: *"Our research indicates that over 100,000 online services are likely to be in scope of the Online Safety Act – from the largest social media platforms to the smallest community forum."* And: *"If organisations have carried out a suitable and sufficient risk assessment and determined, with good reason, that the risks they face are low, they will only be expected to have basic but important measures to remove illegal content when they become aware of it."* And: *"We will take a reasonable approach to enforcement with smaller services that present low risk to UK users, only taking action where it is proportionate and appropriate. We are not setting out to penalise small, low risk services trying to comply in good faith."*

**What the text says**
- There is no size, revenue or commercial threshold in ss.3–4. The Act attaches duties to a "provider", which s.226(3) says can be an individual. s.227(4)(b) and Sch.1 para 7(3) both use "whether or not for profit".
- No Schedule 1 exemption covers a service whose UGC is display names plus route geometry plus results. The email, SMS and one-to-one aural exemptions exclude "identifying content" from the count, but only when the *other* UGC is email, SMS or one-to-one voice. There is **no exemption for a service whose only UGC is identifying content.** A route shared in a group ride is UGC that other users can "encounter". It is not a comment or review on provider content, so para 4 does not fit on its face.
- Who is the provider: the entity or individual with **"control over who can use"** the service. With `approval` registration that is the owner, who approves accounts. Each self-hoster is the provider of their own instance.

**What it leaves open**
- **OPEN (lawyer).** Is the instance *already* a user-to-user service before public rooms? `docs/moderation.md` (on main) says *"the only content another rider can see is a name"*. Group rides share a room code. s.3(2)(a) says it *"does not matter if content is actually shared … as long as a service has a functionality that allows such sharing"*. If it already is one, the "first day" in Sch.3 (Q2 below) may have passed.
- **OPEN (lawyer).** Links with the UK: "significant number" is not defined in s.4. The owner is in the UK and the app is in English. Whether UK users "form one of the target markets" is a factual question, and s.4(6) is an alternative route in.
- **OPEN (lawyer).** Sch.1 para 7 (internal business service) is probably not a fit: riders are not the provider's staff or authorised persons for a business. It was read, not ruled out.
- **OPEN.** Is the Discord bot a "user" under s.55(4)(b)? That depends on whether the bot is "controlled by or on behalf of the provider". The bot runs on Discord, not on the instance, so the question may be moot for the instance itself.

### Q2. Risk assessment (s.9), safety duties (s.10), Ofcom guidance and Codes

**Quotations**
- s.9(2)–(4) [L4]: *"(2) A duty to carry out a suitable and sufficient illegal content risk assessment at a time set out in, or as provided by, Schedule 3. (3) A duty to take appropriate steps to keep an illegal content risk assessment up to date … (4) Before making any significant change to any aspect of a service's design or operation, a duty to carry out a further suitable and sufficient illegal content risk assessment relating to the impacts of that proposed change."*
- s.9(5) [L4] is the checklist the assessment document must follow: *"(a) the user base; (b) the level of risk of individuals who are users of the service encountering … (i) each kind of priority illegal content (with each kind separately assessed), and (ii) other illegal content, taking into account (in particular) algorithms used by the service, and how easily, quickly and widely content may be disseminated by means of the service; (c) the level of risk of the service being used for the commission or facilitation of a priority offence; (d) the level of risk of harm to individuals presented by illegal content of different kinds or by the use of the service for the commission or facilitation of a priority offence; (e) the level of risk of functionalities of the service facilitating the presence or dissemination of illegal content or the use of the service for the commission or facilitation of a priority offence, identifying and assessing those functionalities that present higher levels of risk; (f) the different ways in which the service is used, and the impact of such use on the level of risk of harm that might be suffered by individuals; (g) the nature, and severity, of the harm that might be suffered by individuals from the matters identified in accordance with paragraphs (b) to (f); (h) how the design and operation of the service (including the business model, governance, use of proactive technology, measures to promote users' media literacy and safe use of the service, and other systems and processes) may reduce or increase the risks identified."* Commencement: *"S. 9 in force at 10.1.2024 by S.I. 2023/1420"*.
- s.10(2)–(3) [L5]: *"(2) A duty … to take or use proportionate measures relating to the design or operation of the service to— (a) prevent individuals from encountering priority illegal content by means of the service, (b) effectively mitigate and manage the risk of the service being used for the commission or facilitation of a priority offence … and (c) effectively mitigate and manage the risks of harm to individuals … (3) A duty to operate a service using proportionate systems and processes designed to— (a) minimise the length of time for which any priority illegal content is present; (b) where the provider is alerted by a person to the presence of any illegal content, or becomes aware of it in any other way, swiftly take down such content."*
- **New since 29.6.2026**, s.10(3A) [L5]: *"A duty to operate a service using proportionate systems and processes designed to take down— (a) content in relation to which an intimate image content report is made to the provider (see section 20A(2)), and (b) any other content identified by the provider as the same, or substantially the same, as that content, as soon as reasonably practicable, and no later than 48 hours, after the provider receives the report (unless subsection (3B) applies)."* Annotation: *"S. 10(3A)(3B) inserted (29.6.2026) by Crime and Policing Act 2026 (c. 20), ss. 100(2), 255(1); S.I. 2026/689, reg. 2(1)(j)"*.
- s.10(5), (6) and (8) [L5] require terms of service provisions, covering s.10(3) and, separately, terrorism, CSEA and other priority illegal content, plus s.10(3A). They must be applied consistently and be *"clear and accessible"*.
- s.10(10) [L5]: *"In determining what is proportionate … (a) all the findings of the most recent illegal content risk assessment … and (b) the size and capacity of the provider of a service."*
- Sch.3 para 3 [L12], new services: *"If, on the first day, illegal content risk assessment guidance and CAA guidance are both available, both of the following must be completed within the period of three months beginning with that day— (a) the first illegal content risk assessment of the service, and (b) the first CAA of the service."* Para 4 applies the same rule to an existing service that *"becomes, or again becomes, a Part 3 service"*.
- O2: *"You must complete your first illegal content risk assessment by 16 March 2025. If you start a new user-to-user or search service, or change an existing service so that the Act now applies to it, you must complete your risk assessment within three months from when you started or changed the service."* And: *"Ofcom recommends that risk assessments are reviewed at least every 12 months"* (O9 ¶2.45 says the same). O2 also: *"we may impose a penalty of up to 10% of qualifying worldwide revenue or £18 million (whichever is the greater)"*.
- O8, dates table: *"17 March 2025 | Illegal content Codes of Practice comes into force | Comply with the illegal content safety duties | All OS services"*. O10 (snippet): *"Update 24 February 2025 - illegal content Codes of Practice issued."*
- O9, four steps: *"Step 1: Understand the kinds of illegal content that need to be assessed"*, *"Step 2: Assess the risk of harm"*, *"Step 3: Decide measures, implement, and record"*, *"Step 4: Report, review, and update"*. Step 1 says: *"Identify the 17 kinds of priority illegal content that need to be separately assessed."* ⚠️ That count comes from the Dec 2024 text. O10 says the government created two new priority offences in December 2025 (serious self-harm, and cyberflashing) and that Ofcom updated its documents on 25 June 2026, so **the current count may differ. OPEN.**
- O9, risk levels: *"Low risk You assess that there is a low likelihood that a user would encounter illegal harm on your service • You have used evidence to assess whether the harm is taking place on your service and have concluded that there is no evidence of this, and you have identified no or few specific risk factors associated with the kind of harm in the relevant Risk Profiles."* And: *"Negligible or no risk If your evidence shows it is not possible or extremely unlikely that this kind of illegal harm takes place by means of your service, you may assess the risk of that harm as 'negligible or no risk' … If you have some of the relevant risk factors and the kind of illegal harm is possible on your service, then to assess as 'negligible or no risk' … you will normally need comprehensive evidence to demonstrate that your service does not pose low, medium or high risk."* Image CSAM: *"Negligible or no risk Where the service's functionalities do not enable images or videos to be generated, uploaded or shared on the service and image-based CSAM is therefore impossible or extremely unlikely to be encountered on the service."*
- O9, risk factors relevant to this service (verbatim openings):
  - *"Risk factor: User profiles • Key kinds of illegal harm: … fraud and financial services, proceeds of crime, foreign interference, CSEA (grooming), harassment/stalking/threats/abuse, drugs and psychoactive substances, hate, unlawful immigration, human trafficking, and sexual exploitation of adults offences."*
  - *"Risk factor: Posting or sending location information • Key kinds of illegal harm: … CSEA (grooming), harassment/stalking/threats/abuse, human trafficking and controlling or coercive behaviour offences. Posting or sending location information may be used by potential perpetrators to track the whereabouts of survivors and victims."*
  - *"Risk factor: User connections …"* and *"Risk factor: Group messaging …"* (relevant if room chat is built).
  - *"Risk factor: Livestreaming …"* (relevant only if voice or video were hosted on the service).
- O9, Table 8 (what the record must contain, in part): *"The service to which the risk assessment relates; • The date the risk assessment was completed; • If applicable, the date the risk assessment was reviewed or updated; • Who completed the risk assessment, and the named person responsible for the risk assessment; • Who approved the risk assessment; • Confirmation that your service has consulted Ofcom's Risk Profiles …; • A record of any risk factors from Ofcom's Risk Profiles which are relevant to your service …"*

**Codes of Practice [O1]: measures that apply to ALL services, verbatim from the Index**

| ID | Title | Application |
|---|---|---|
| ICU A2 | Individual accountable for illegal content safety duties and reporting and complaints duties | All services |
| ICU C1 | Having a content moderation function to review and assess suspected illegal content | All services |
| ICU C2 | Having a content moderation function that allows for the swift take down of illegal content | All services |
| ICU D1 | Enabling complaints | All services |
| ICU D2 | Having easy to find, easy to access and easy to use complaints systems and processes | All services |
| ICU D7 | Appropriate action for relevant complaints about suspected illegal content | All services |
| ICU D9 | Appeals, determination (services that are neither large nor multi risk) | "Services that are neither large nor multi-risk" |
| ICU D10 | Appeals, action following determination | All services |
| ICU D11, D12, D13 | Proactive-technology complaints; all other relevant complaints; manifestly unfounded complaints | Blank in the Index table; each measure's own text reads *"This measure applies to a provider in respect of each service it provides"* (D11.1, D12.1, D13.1) |
| ICU G1 | Terms of service: substance (all services) | All services |
| ICU G3 | Terms of service: clarity and accessibility | All services |
| ICU H1 | Removing accounts of proscribed organisations | All services |

- Size-based measures [O1 §5]: *"Large service A service which has more than 7 million monthly active United Kingdom users"*. ¶5.6: *"A service is a multi-risk service if it is at medium or high risk of two or more kinds of illegal harm set out in table C (excluding the kinds of illegal harm set out in rows 2A, 2B and 2C)."* The **700,000** threshold appears only in C9 (CSAM hash matching), C10 (CSAM URLs) and C14 (intimate-image hash matching), each combined with high risk. ¶5.10: *"an active United Kingdom user means any United Kingdom user who has accessed the user-to-user part of the service."*
- These measures apply to "large or multi-risk" services: A3, A5, A6, A7, C3–C8 and D8. D3–D6 apply to *"Services that are large or at medium or high risk of any kind of illegal harm"*, and D3/D5 only to such services that are likely to be accessed by children. J1 (block and mute) applies to large services only in this version. O10 says Ofcom consulted on 24 April 2025 on extending J1/J2 to smaller services likely to be accessed by children; the outcome was **not read**.
- Key measure texts [O1]:
  - A2.2: *"The provider should name an individual accountable to the most senior governance body for compliance with the illegal content safety duties and the reporting and complaints duties."*
  - C1.3: *"when the provider has reason to suspect that content may be illegal content, the provider should review the content and either: a) make an illegal content judgement in relation to the content; or b) where the provider is satisfied that its terms of service prohibit the type of illegal content which it has reason to suspect exist, consider whether the content is in breach of those terms of service."*
  - C2.2: *"… have systems and processes designed to swiftly take down illegal content and/or illegal content proxy of which it is aware …"*
  - D2.2: *"a) for relevant complaints regarding a specific piece of content, a reporting function or tool is clearly accessible in relation to that content; b) processes for making other kinds of relevant complaints are easy to find and easily accessible; c) they are designed so that they only include reasonably necessary steps; and d) it is possible when making relevant complaints to give the provider supporting information."*
  - D2.4: *"… usability for those dependent on assistive technologies including: a) keyboard navigation; and b) screen reading technology."*
  - D7.2(b): *"if Recommendations ICU C4 and ICU C5 are not applicable to the provider, it should consider the complaint promptly."*
  - D9.2: *"The provider should determine relevant complaints which are appeals promptly."*
  - D12.3: *"The provider should nominate a responsible individual or a team to ensure that such complaints are directed to an appropriate individual …"*
  - G3.2(c): *"written to a reading age comprehensible for the youngest individual permitted to use the service without the consent of a parent or guardian"*.
- O1, definition of "Volunteer": *"An individual who, in relation to the activity in question, is not: a) employed by the provider or anyone else, b) remunerated, c) acting by way of a business."*
- O1 also defines *"Automated location information display functionality"*. It is used in the child-safety-default measures (F1). Not read in depth.

**Other in-force duties found in passing (first-hand)**
- s.66(1) [L13]: *"A UK provider of a regulated user-to-user service must operate the service using systems and processes which secure (so far as possible) that the provider reports all detected and unreported CSEA content present on the service to the NCA."* In force: *"S. 66(1)(2) in force at 7.4.2026 by S.I. 2026/262"*.
- s.20A (intimate image content reports, 48-hour takedown in s.10(3A)) was inserted 29.6.2026 by the Crime and Policing Act 2026. **Issue #886 does not mention either duty.**

**What it leaves open**
- **OPEN (owner and lawyer).** When is "the first day"? The Act allows three months *after* the service becomes a Part 3 service (Sch.3 paras 3–4). The owner's ruling (assess *before* public rooms) is stricter than that, which is fine. But if the instance already counts as U2U with display names and group rides (Q1), its clock may already be running.
- **OPEN (owner).** s.9(4) requires a *further* assessment before any "significant change", for example adding room chat (#794 or a future issue) or public rooms. The assessment document should state which features it covers.
- **OPEN (owner).** Who is the A2 "accountable individual" and what is the "most senior governance body" for a one-person project? With one moderator (#905) these are all the owner. The Codes do not say how a sole individual meets A2. Recording it as such looks like the natural reading, but that is unconfirmed.
- **OPEN.** The current Risk Assessment Guidance (25 June 2026 update) and Risk Profiles could not be read. The text quoted above may be superseded.

### Q3. Children's access assessment (ss.35–37)

**Quotations**
- s.35(1) [L9]: *"… a "children's access assessment" means an assessment of a Part 3 service— (a) to determine whether it is possible for children to access the service or a part of the service, and (b) if it is possible for children to access the service or a part of the service, to determine whether the child user condition is met …"*
- **s.35(2)** [L9]: *"A provider is only entitled to conclude that it is not possible for children to access a service, or a part of it, if age verification or age estimation is used on the service with the result that children are not normally able to access the service or that part of it."* The same sentence appears as s.20(6) and s.21(8).
- s.35(3)–(4) [L9]: *"The "child user condition" is met … if— (a) there is a significant number of children who are users of the service or of that part of it, or (b) the service, or that part of it, is of a kind likely to attract a significant number of users who are children. (4) … (a) the reference to a "significant" number includes a reference to a number which is significant in proportion to the total number of United Kingdom users … (b) whether the test in paragraph (a) … is met is to be based on evidence about who actually uses a service, rather than who the intended users of the service are."*
- **s.230(4)** [L11]: *"A measure which requires a user to self-declare their age (without more) is not to be regarded as age verification or age estimation."*
- s.36(3), (4) and (7) [L9]: *"(3) The provider must carry out children's access assessments of the service not more than one year apart. (4) … a children's access assessment … (a) before making any significant change to any aspect of the service's design or operation to which such an assessment is relevant, (b) in response to evidence about reduced effectiveness of age verification or age estimation … or (c) in response to evidence about a significant increase in the number of children using the service. … (7) A provider must make and keep a written record, in an easily understandable form, of every children's access assessment."*
- s.37(4)–(5) [L9]: if the provider *"fails to carry out the first children's access assessment"*, the service *"is to be treated as likely to be accessed by children from the date by which the first children's access assessment was required to have been completed"*.
- O4 (updated 29 June 2026):
  - *"If you provide a service that came into scope of the Act after 16 January 2025, you have three months to complete your assessment from the first day your service became available to users in the UK."*
  - *"You can only conclude that it is not possible for children to access the service if you are using highly effective age assurance, as well as access control measures that prevent users from accessing the service if they have not been identified as adults via the age assurance process."*
  - *"Examples of age assurance methods that are not highly effective include: payment methods which do not require the user to be over 18 [;] your terms and conditions say the service is for over 18s only"*.
  - Factors: *"Whether the service provides benefits to children; Whether the content on a service is appealing to children; Whether the design of the service is appealing to children; Whether children form part of the service's commercial strategy."*
  - *"The Act does not define what is meant by a 'significant number' of children. This is likely to depend on the nature and context of the service and should reflect a number or proportion that is material in the context of that service. Even a relatively small number of children could be significant in terms of the risk of harm. We suggest you should err on the side of caution in making your assessment."*
  - *"If you go on to stage 2 of the children's access assessment and conclude that the child user condition is not met (the service is not likely to be accessed by children), you must record the steps taken and the detailed evidence used to reach that conclusion."*
  - *"All user-to-user and search services must carry out a children's access assessment by 16 April 2025."*
- O5, toolkit: *"Self-declaration of age If you allow users to self-declare their age, you should not rely on this data alone to conclude that you do not have a significant number of users who are children, as the Act states that measures which require users to self-declare their age (without other methods) are not to be regarded as age assurance."*
- O6 ¶3.14: *"Self-declaration of age 3.14 The Act states that measures which require users to self-declare their age (without other methods) are not to be regarded as age assurance. These include: • asking a user to input their date of birth without any further evidence to confirm this information; or • asking a user to tick a box to confirm that they are 18 years of age or over."* ¶3.16 also lists *"including as part of the terms of service a condition that prohibits users who are under 18 years old from using the service, without any additional age assurance"*.
- O7: *"we anticipate that most Part 3 services that do not use highly effective age assurance are likely to be accessed by children within the meaning of the Act."*

**What the text says**
- 18+ self-declaration (#775's tick box) **cannot** support a Stage-1 conclusion that children cannot access the service. s.35(2), with s.230(4), is explicit, and Ofcom's ¶3.14 names the tick box.
- The assessment must therefore go to **Stage 2**, the child user condition. At Stage 2 self-declared data cannot be relied on "alone". Approval-required registration, the adult framing, and the fact that a cycling training app is not designed for children are possible Stage-2 factors. Ofcom says "err on the side of caution".
- If the conclusion is "likely to be accessed by children", the children's risk assessment and the children's safety duties follow (s.37(1) refers to ss.11 and 12). **These were not read. OPEN.**
- Ofcom's toolkit example says that where it is *"publicly known that the service is used by children"* the condition is met. Cycling apps have junior riders. That is a fact the assessment must weigh.

**OPEN (owner and lawyer):** the conclusion itself (Stage 2), and whether approval-by-a-human is admissible evidence. **Not read:** Ofcom's Children's Access Assessments Guidance PDF (see §5).

### Q4. Record-keeping (s.23) and reporting and complaints (ss.20, 21)

**Quotations**
- s.20(2)–(3) [L6]: *"A duty to operate a service using systems and processes that allow users and affected persons to easily report content which they consider to be content of a kind specified below … All services (3) Illegal content."*
- s.20(5) [L6]: *""affected person" means a person, other than a user of the service in question, who is in the United Kingdom and who is— (a) the subject of the content, (b) a member of a class or group of people with a certain characteristic targeted by the content, (c) a parent of, or other adult with responsibility for, a child who is a user of the service or is the subject of the content, or (d) an adult providing assistance in using the service to another adult …"*
- s.20A(1)–(2) [L6], since 29.6.2026: *"The duty in section 20(2) includes a duty to operate a service using systems and processes that allow users and affected persons to easily make an intimate image content report … (2) An "intimate image content report" is a report which— (a) declares that content present on the service is intimate image content, (b) declares that the report is made by— (i) the subject of the content, or (ii) a person acting on that person's behalf, (c) declares that the report— (i) is made in good faith, and (ii) … is true, (d) provides sufficient information about the content for the provider to identify it, (e) provides contact details for the person making the report, and (f) complies with any other requirements specified in regulations …"*
- s.21(2) [L7]: *"A duty to operate a complaints procedure … that— (a) allows for relevant kinds of complaint to be made … (b) provides for appropriate action to be taken by the provider … and (c) is easy to access, easy to use (including by children) and transparent."* s.21(2A) (since 29.6.2026): an *"expedited complaints procedure"* for intimate image content report complainants. s.21(3): *"A duty to include in the terms of service provisions which are easily accessible (including to children) specifying the policies and processes that govern the handling and resolution of complaints of a relevant kind."*
- s.21(4) [L7], relevant for all services: *"(a) complaints by users and affected persons about content present on a service which they consider to be illegal content; (b) complaints … if they consider that the provider is not complying with a duty set out in— (i) section 10 … (ii) section 20 … (iii) section 22(2) or (3) …; (c) complaints by a user who has generated, uploaded or shared content on a service if that content is taken down on the basis that it is illegal content; (d) complaints by a user of a service if the provider has given a warning to the user, suspended or banned the user from using the service, or in any other way restricted the user's ability to use the service, as a result of content generated, uploaded or shared by the user which the provider considers to be illegal content; (e) … proactive technology …"*
- s.23(2)–(4) and (6) [L8]: *"(2) A duty to make and keep a written record, in an easily understandable form, of all aspects of every risk assessment under section 9 or 11, including details about how the assessment was carried out and its findings. (3) A duty to make and keep a written record of any measures taken or in use to comply with a relevant duty which— (a) are described in a code of practice and recommended … and (b) apply in relation to the provider and the service in question. (4) If alternative measures have been taken … a written record containing … (a) the applicable measures in a code of practice that have not been taken or are not in use, (b) the alternative measures … (c) how those alternative measures amount to compliance … (d) how the provider has complied with section 49(5) … (6) A duty to review compliance with the relevant duties … (a) regularly, and (b) as soon as reasonably practicable after making any significant change …"*
- s.23(7) [L8]: *"OFCOM may provide that particular descriptions of providers of user-to-user services are exempt from any or all of the duties set out in this section …"*. **Whether Ofcom has made any such exemption was not established** (see §5).
- s.23(10): a copy of the record goes to Ofcom only for Category 1 services (s.9 records) and on request. O2: *"Most services do not need to send their records to Ofcom but should be aware that we can ask for them at any time."*

**What the text says, set against the repository**
- s.20 covers **"affected persons"**, who are non-users in the UK. `docs/moderation.md` describes reporting as a signed-in rider reporting *a rider id*, 5 per hour. A route for non-users, and one for a *specific piece of content* (D2.2(a)), is not described there. This is a gap to note, not a conclusion.
- s.21(4)(c)–(d) and ICU D9/D10 require an **appeal** route for a rider whose content was taken down or who was suspended "as a result of content … the provider considers to be illegal content". `docs/moderation.md` describes no appeal route (grep for "appeal" found none).
- ICU G1/G3 and s.10(5) and s.21(3) require **terms of service** provisions. `git ls-tree origin/main` shows no terms of service document (only `CODE_OF_CONDUCT.md`, which is for contributors, and `docs/privacy-policy.md`).
- **OPEN (owner).** How does one moderator (#905) handle a complaint *about* the moderator? #905's first item is the same problem at the software level.

### Q5. Ofcom's "check if the Act applies" and small-services material

- O3 exists and points to *"Check if the Online Safety Act applies to you - Ofcom"* and a digital toolkit. Quotations are under Q1.
- The Ofcom June 2026 bulletin (search snippet only) says the scope tool was *"recently updated"*.
- The interactive scope checker and the compliance toolkit were **not run**: they are interactive, and running them would record answers with Ofcom. O2 says the toolkit stores answers *"but it will not be attributed to you or your service"*. **OPEN (owner):** whether to run them and attach the output to the assessment.

---

## 3. EU: Digital Services Act, Regulation (EU) 2022/2065

Text read: **OJ L 277, 27.10.2022, as published.** Consolidated versions were **not** checked (see §5). Art. 93(2): *"This Regulation shall apply from 17 February 2024."*

### Q6. Definitions: hosting service, online platform, dissemination to the public

- Art. 3(g) [E1]: *"'intermediary service' means one of the following information society services: … (iii) a 'hosting' service, consisting of the storage of information provided by, and at the request of, a recipient of the service"*.
- Art. 3(i) [E1]: *"'online platform' means a hosting service that, at the request of a recipient of the service, stores and disseminates information to the public, unless that activity is a minor and purely ancillary feature of another service or a minor functionality of the principal service and, for objective and technical reasons, cannot be used without that other service, and the integration of the feature or functionality into the other service is not a means to circumvent the applicability of this Regulation"*.
- Art. 3(k) [E1]: *"'dissemination to the public' means making information available, at the request of the recipient of the service who provided the information, to a potentially unlimited number of third parties"*.
- **Recital 14** [E1]: *"… Accordingly, where access to information requires registration or admittance to a group of recipients of the service, that information should be considered to be disseminated to the public only where recipients of the service seeking to access the information are automatically registered or admitted without a human decision or selection of whom to grant access. Interpersonal communication services … such as emails or private messaging services, fall outside the scope of the definition of online platforms as they are used for interpersonal communication between a finite number of persons determined by the sender of the communication. However, the obligations set out in this Regulation for providers of online platforms may apply to services that allow the making available of information to a potentially unlimited number of recipients, not determined by the sender of the communication, such as through public groups or open channels."*
- Recital 13 [E1]: *"… providers of hosting services should not be considered as online platforms where the dissemination to the public is merely a minor and purely ancillary feature that is intrinsically linked to another service … For example, the comments section in an online newspaper could constitute such a feature …"*
- Recital 15 [E1]: *"Where some of the services provided by a provider are covered by this Regulation whilst others are not, or where the services provided by a provider are covered by different sections of this Regulation, the relevant provisions of this Regulation should apply only in respect of those services that fall within their scope."*
- Scope, Art. 2(1) [E1]: *"This Regulation shall apply to intermediary services offered to recipients of the service that have their place of establishment or are located in the Union, irrespective of where the providers of those intermediary services have their place of establishment."*
- Art. 3(d)–(e) [E1]: *"'to offer services in the Union' means enabling natural or legal persons in one or more Member States to use the services of a provider of intermediary services that has a substantial connection to the Union"*. And: *"'substantial connection to the Union' means a connection … resulting either from its establishment in the Union or from specific factual criteria, such as: —a significant number of recipients of the service in one or more Member States in relation to its or their population; or —the targeting of activities towards one or more Member States"*.
- Recital 8 [E1]: *"… The targeting of activities towards a Member State could also be derived from the availability of an application in the relevant national application store … In contrast, mere technical accessibility of a website from the Union cannot, on that ground alone, be considered as establishing a substantial connection to the Union."*

**What the text says**
- If the DSA applies at all (see Q9), an instance that stores display names, routes and results at a rider's request is on its face a **hosting service**.
- Whether it is an **online platform** turns on "dissemination to the public". Recital 14 says that where access requires admittance *by a human decision*, the information is **not** disseminated to the public. With the project's instance on `approval` registration, public-room content is visible only to riders a human approved. On recital 14's words that points **away** from "online platform" for the project's instance.
- A self-hoster running `open` registration may be in a different position.

**OPEN (lawyer):**
- Does recital 14 carry the weight put on it? A recital is interpretive, not operative.
- Is the room listing a "public group or open channel"?
- Substantial connection: the Android app's availability in EU Member States' Play stores is exactly recital 8's example. Which countries the APK or Play listing covers is a fact for the owner.

### Q7. Arts 11, 12, 13: points of contact and legal representative

- Art. 11(1)–(3) [E1]: *"1. Providers of intermediary services shall designate a single point of contact to enable them to communicate directly, by electronic means, with Member States' authorities, the Commission and the Board … 2. … make public the information necessary to easily identify and communicate with their single points of contact. That information shall be easily accessible, and shall be kept up to date. 3. … specify … the official language or languages of the Member States which, in addition to a language broadly understood by the largest possible number of Union citizens, can be used to communicate with their points of contact, and which shall include at least one of the official languages of the Member State in which the provider … has its main establishment or where its legal representative resides or is established."*
- Art. 12(1)–(2) [E1]: *"1. Providers of intermediary services shall designate a single point of contact to enable recipients of the service to communicate directly and rapidly with them, by electronic means and in a user-friendly manner, including by allowing recipients of the service to choose the means of communication, which shall not solely rely on automated tools. 2. … make public the information necessary for the recipients of the service in order to easily identify and communicate with their single points of contact. That information shall be easily accessible, and shall be kept up to date."*
- **Art. 13** [E1]:
  - *"1. Providers of intermediary services which do not have an establishment in the Union but which offer services in the Union shall designate, in writing, a legal or natural person to act as their legal representative in one of the Member States where the provider offers its services."*
  - *"2. … mandate their legal representatives for the purpose of being addressed in addition to or instead of such providers … on all issues necessary for the receipt of, compliance with and enforcement of decisions … Providers … shall provide their legal representative with necessary powers and sufficient resources …"*
  - *"3. It shall be possible for the designated legal representative to be held liable for non-compliance …"*
  - *"4. … notify the name, postal address, email address and telephone number of their legal representative to the Digital Services Coordinator in the Member State where that legal representative resides or is established. They shall ensure that that information is publicly available, easily accessible, accurate and kept up to date."*
  - *"5. The designation of a legal representative within the Union … shall not constitute an establishment in the Union."*

**What the text says:** Art. 13 applies to a provider with no EU establishment that "offers services in the Union". The owner is in the UK. **No micro or small exemption appears in Arts 11–14.** Art. 15(2) exempts only Art. 15, and Art. 19 only Section 3.

**OPEN (owner and lawyer):**
- Whether the project "offers services in the Union" at all (Art. 3(d)–(e), recital 8), and whether the DSA reaches a non-commercial service (Q9).
- If it does, Art. 13 requires a named natural or legal person in a Member State who can be held liable. That is a real cost and a real person.
- A decision to **geo-restrict** the project's instance or public rooms to non-EU riders would be the owner's to make. Its effect on "offering services in the Union" is not stated in the text read.

### Q8. Arts 14, 16 and 17

**Art. 14, terms and conditions** [E1]:
- *"1. Providers of intermediary services shall include information on any restrictions that they impose in relation to the use of their service in respect of information provided by the recipients of the service, in their terms and conditions. That information shall include information on any policies, procedures, measures and tools used for the purpose of content moderation, including algorithmic decision-making and human review, as well as the rules of procedure of their internal complaint handling system. It shall be set out in clear, plain, intelligible, user-friendly and unambiguous language, and shall be publicly available in an easily accessible and machine-readable format."*
- *"2. Providers of intermediary services shall inform the recipients of the service of any significant change to the terms and conditions."*
- *"3. Where an intermediary service is primarily directed at minors or is predominantly used by them, the provider … shall explain the conditions for, and any restrictions on, the use of the service in a way that minors can understand."*
- *"4. Providers … shall act in a diligent, objective and proportionate manner in applying and enforcing the restrictions referred to in paragraph 1, with due regard to the rights and legitimate interests of all parties involved, including the fundamental rights of the recipients of the service, such as the freedom of expression, freedom and pluralism of the media, and other fundamental rights and freedoms as enshrined in the Charter."*
- Paragraphs 5 and 6 apply to very large platforms and search engines only.

**Art. 16, notice and action, every paragraph** [E1]:
1. *"Providers of hosting services shall put mechanisms in place to allow any individual or entity to notify them of the presence on their service of specific items of information that the individual or entity considers to be illegal content. Those mechanisms shall be easy to access and user-friendly, and shall allow for the submission of notices exclusively by electronic means."*
2. *"The mechanisms referred to in paragraph 1 shall be such as to facilitate the submission of sufficiently precise and adequately substantiated notices. To that end, the providers of hosting services shall take the necessary measures to enable and to facilitate the submission of notices containing all of the following elements: (a) a sufficiently substantiated explanation of the reasons why the individual or entity alleges the information in question to be illegal content; (b) a clear indication of the exact electronic location of that information, such as the exact URL or URLs, and, where necessary, additional information enabling the identification of the illegal content adapted to the type of content and to the specific type of hosting service; (c) the name and email address of the individual or entity submitting the notice, except in the case of information considered to involve one of the offences referred to in Articles 3 to 7 of Directive 2011/93/EU; (d) a statement confirming the bona fide belief of the individual or entity submitting the notice that the information and allegations contained therein are accurate and complete."*
3. *"Notices referred to in this Article shall be considered to give rise to actual knowledge or awareness for the purposes of Article 6 in respect of the specific item of information concerned where they allow a diligent provider of hosting services to identify the illegality of the relevant activity or information without a detailed legal examination."*
4. *"Where the notice contains the electronic contact information of the individual or entity that submitted it, the provider of hosting services shall, without undue delay, send a confirmation of receipt of the notice to that individual or entity."*
5. *"The provider shall also, without undue delay, notify that individual or entity of its decision in respect of the information to which the notice relates, providing information on the possibilities for redress in respect of that decision."*
6. *"Providers of hosting services shall process any notices that they receive under the mechanisms referred to in paragraph 1 and take their decisions in respect of the information to which the notices relate, in a timely, diligent, non-arbitrary and objective manner. Where they use automated means for that processing or decision-making, they shall include information on such use in the notification referred to in paragraph 5."*

Recital 50 [E1] adds these points:
- *"It is important that all providers of hosting services, regardless of their size, put in place easily accessible and user-friendly notice and action mechanisms …"*
- *"Such mechanisms should be clearly identifiable, located close to the information in question and at least as easy to find and use as notification mechanisms for content that violates the terms and conditions of the hosting service provider."*
- *"… it should be possible for individuals or entities to notify multiple specific items of allegedly illegal content through a single notice …"*
- *"The notification mechanism should allow, but not require, the identification of the individual or the entity submitting a notice."*

Recital 52 [E1]: *"… such providers can be expected to act without delay when allegedly illegal content involving a threat to life or safety of persons is being notified."*

**Art. 17, statement of reasons** [E1]:
- 17(1): *"Providers of hosting services shall provide a clear and specific statement of reasons to any affected recipients of the service for any of the following restrictions imposed on the ground that the information provided by the recipient of the service is illegal content or incompatible with their terms and conditions: (a) any restrictions of the visibility of specific items of information provided by the recipient of the service, including removal of content, disabling access to content, or demoting content; (b) suspension, termination or other restriction of monetary payments; (c) suspension or termination of the provision of the service in whole or in part; (d) suspension or termination of the recipient of the service's account."*
- 17(2): *"Paragraph 1 shall only apply where the relevant electronic contact details are known to the provider. It shall apply at the latest from the date that the restriction is imposed, regardless of why or how it was imposed. Paragraph 1 shall not apply where the information is deceptive high-volume commercial content."*
- **17(3), every element**: *"The statement of reasons referred to in paragraph 1 shall at least contain the following information:*
  - *(a) information on whether the decision entails either the removal of, the disabling of access to, the demotion of or the restriction of the visibility of the information, or the suspension or termination of monetary payments related to that information, or imposes other measures referred to in paragraph 1 with regard to the information, and, where relevant, the territorial scope of the decision and its duration;*
  - *(b) the facts and circumstances relied on in taking the decision, including, where relevant, information on whether the decision was taken pursuant to a notice submitted in accordance with Article 16 or based on voluntary own-initiative investigations and, where strictly necessary, the identity of the notifier;*
  - *(c) where applicable, information on the use made of automated means in taking the decision, including information on whether the decision was taken in respect of content detected or identified using automated means;*
  - *(d) where the decision concerns allegedly illegal content, a reference to the legal ground relied on and explanations as to why the information is considered to be illegal content on that ground;*
  - *(e) where the decision is based on the alleged incompatibility of the information with the terms and conditions of the provider of hosting services, a reference to the contractual ground relied on and explanations as to why the information is considered to be incompatible with that ground;*
  - *(f) clear and user-friendly information on the possibilities for redress available to the recipient of the service in respect of the decision, in particular, where applicable through internal complaint-handling mechanisms, out-of-court dispute settlement and judicial redress."*
- 17(4): *"The information … shall be clear and easily comprehensible and as precise and specific as reasonably possible under the given circumstances. The information shall, in particular, be such as to reasonably allow the recipient of the service concerned to effectively exercise the possibilities for redress referred to in of paragraph 3, point (f)."*
- 17(5): *"This Article shall not apply to any orders referred to in Article 9."*
- Recital 54 [E1]: *"Where the decision was taken following receipt of a notice, the provider of hosting services should only reveal the identity of the person or entity who submitted the notice to the recipient of the service where this information is necessary to identify the illegality of the content …"*. Recital 55: *"… the recipient of the service should always have a right to effective remedy before a court in accordance with the national law."*

**Art. 18** (hosting services; no size exemption) [E1]: *"1. Where a provider of hosting services becomes aware of any information giving rise to a suspicion that a criminal offence involving a threat to the life or safety of a person or persons has taken place, is taking place or is likely to take place, it shall promptly inform the law enforcement or judicial authorities of the Member State or Member States concerned of its suspicion and provide all relevant information available. 2. Where the provider … cannot identify with reasonable certainty the Member State concerned, it shall inform the law enforcement authorities of the Member State in which it is established or where its legal representative resides or is established or inform Europol, or both."* **#887 does not mention Art. 18.**

**Measured against the repository and #887**
- Art. 16(1) says **"any individual or entity"**, not only account holders. The #83 report route needs a signed-in rider (`docs/moderation.md`). A notice route that works without an account (the owner's planned dedicated email address fits Art. 16(1)'s "electronic means") is what the text points at.
- Art. 16(2)(b) asks for the "exact electronic location" of the item. Today a report names a *rider id*, not an item such as a display name, a room or a route. The form must let a notifier identify the specific item.
- Art. 16(2)(c): the mechanism must *enable* name and email, except for the CSAM offences. Recital 50 says identification must be allowed, not required.
- Art. 17(2): a statement of reasons is owed only *"where the relevant electronic contact details are known"*. The instance knows a rider only by device key and holds no email (`docs/moderation.md`). **OPEN (lawyer):** does an in-app account message channel count as "electronic contact details"? If yes, the instance needs somewhere to deliver the statement, and it has none today.
- #887's criterion names "a named deputy (ruling Q13)". **#905 (2026-09-30) reverses that: one moderator.** The procedure must be written for one person.

### Q9. Art. 15 transparency; Art. 19; Arts 20–24; Rec. 2003/361; is a non-commercial individual in scope?

**Quotations**
- Art. 15(1) [E1] (annual content moderation report, items (a)–(e); (b) is notices under Art. 16, with counts and median time). **Art. 15(2)**: *"Paragraph 1 of this Article shall not apply to providers of intermediary services that qualify as micro or small enterprises as defined in Recommendation 2003/361/EC and which are not very large online platforms within the meaning of Article 33 of this Regulation."*
- **Art. 19** [E1]: *"1. This Section, with the exception of Article 24(3) thereof, shall not apply to providers of online platforms that qualify as micro or small enterprises as defined in Recommendation 2003/361/EC. This Section, with the exception of Article 24(3) thereof, shall not apply to providers of online platforms that previously qualified for the status of a micro or small enterprise … during the 12 months following their loss of that status … except when they are very large online platforms … 2. By derogation from paragraph 1 … this Section shall apply to providers of online platforms that have been designated as very large online platforms …"*. "This Section" is Chapter III **Section 3**, "Additional provisions applicable to providers of online platforms" (Arts 19–28).
- Recital 57 [E1]: *"To avoid disproportionate burdens, the additional obligations imposed under this Regulation on providers of online platforms … should not apply to providers that qualify as micro or small enterprises as defined in Recommendation 2003/361/EC. … Nothing in this Regulation precludes providers of online platforms that are covered by that exclusion from setting up, on a voluntary basis, a system that complies with one or more of those obligations."*
- Arts 20–24 at a glance (opening words only) [E1]:
  - Art. 20: *"Providers of online platforms shall provide recipients of the service, including individuals or entities that have submitted a notice, for a period of at least six months following the decision …, with access to an effective internal complaint-handling system …"*
  - Art. 21: out-of-court dispute settlement.
  - Art. 22: *"notices submitted by trusted flaggers … are given priority"*.
  - Art. 23(1): *"Providers of online platforms shall suspend, for a reasonable period of time and after having issued a prior warning, the provision of their services to recipients of the service that frequently provide manifestly illegal content."*
  - Art. 24: transparency; 24(2) monthly active recipients; 24(3) on request; 24(5) the database (Q10).
- Rec. 2003/361/EC, Annex [E3]:
  - Art. 1: *"An enterprise is considered to be any entity engaged in an economic activity, irrespective of its legal form. This includes, in particular, self-employed persons and family businesses engaged in craft or other activities, and partnerships or associations regularly engaged in an economic activity."*
  - Art. 2(2): *"… a small enterprise is defined as an enterprise which employs fewer than 50 persons and whose annual turnover and/or annual balance sheet total does not exceed EUR 10 million."*
  - Art. 2(3): *"… a microenterprise is defined as an enterprise which employs fewer than 10 persons and whose annual turnover and/or annual balance sheet total does not exceed EUR 2 million."*
  - Recital 3: *"… an enterprise should be considered to be any entity, regardless of its legal form, engaged in economic activities …"*
- **Scope: remuneration.**
  - DSA Art. 3(a) [E1]: *"'information society service' means a 'service' as defined in Article 1(1), point (b), of Directive (EU) 2015/1535"*.
  - Directive (EU) 2015/1535, Art. 1(1)(b) [E2]: *"'service' means any Information Society service, that is to say, any service normally provided for remuneration, at a distance, by electronic means and at the individual request of a recipient of services."*
  - DSA recital 5 [E1]: *"This Regulation should apply to providers of certain information society services as defined in Directive (EU) 2015/1535 …, that is, any service normally provided for remuneration, at a distance, by electronic means and at the individual request of a recipient."*
  - Directive 2000/31/EC, recital 18 [E4]: *"… information society services are not solely restricted to services giving rise to on-line contracting but also, in so far as they represent an economic activity, extend to services which are not remunerated by those who receive them, such as those offering on-line information or commercial communications, or those providing tools allowing for search, access and retrieval of data; information society services also include services consisting of … hosting information provided by a recipient of the service; … the use of electronic mail or equivalent individual communications for instance by natural persons acting outside their trade, business or profession including their use for the conclusion of contracts between such persons is not an information society service …"*

**What the text says, without going beyond it**
- The DSA reaches only "information society services", defined as services "**normally** provided for remuneration". The e-Commerce Directive's recital 18 extends this to services "not remunerated by those who receive them" **"in so far as they represent an economic activity"**. The texts read do not say whether a free, non-commercial service run by one private individual is an "economic activity". The owner's case depends on that.
- The same "economic activity" test decides whether the owner is an "enterprise" under Rec. 2003/361 at all. If the owner is **not** an enterprise, the micro/small exemptions (Art. 15(2), Art. 19), which are written for "enterprises", may be beside the point, because the DSA may not apply in the first place. Either way the text read does not decide it.
- **If** the DSA applies and the owner counts as a micro enterprise: Art. 15 reporting is exempt (15(2)). Section 3 (Arts 20–28, and 24(5)) is exempt except 24(3), and only if the service is an online platform at all (Q6). **Arts 11, 12, 13, 14, 16, 17 and 18 have no size exemption.** That matches #887's premise that Art. 19 excludes micro and small enterprises "from the online platform obligations only, not from Art. 16".

**OPEN (lawyer), and the question most likely to decide scope:** is a free, non-commercial instance run by a private individual an information society service, and is the owner an "enterprise"? CJEU case law on "normally provided for remuneration" was **not read**. No case is cited here, because none was read. Nothing here should be taken to say the DSA does or does not apply.

### Q10. Transparency Database (Art. 24(5)): hosting services or online platforms?

- Art. 24(5) [E1]: *"Providers of online platforms shall, without undue delay, submit to the Commission the decisions and the statements of reasons referred to in Article 17(1) for the inclusion in a publicly accessible machine-readable database managed by the Commission. Providers of online platforms shall ensure that the information submitted does not contain personal data."*
- Art. 24 sits in Section 3, so Art. 19 excludes micro and small online platforms from 24(5). Only 24(3) survives the exclusion.
- E5 (Commission FAQ, updated 7 July 2025): *"Article 17 of the Digital Services Act (DSA) requires all providers of hosting services to provide clear and specific information, called statements of reasons, to users whenever they remove or otherwise restrict access to their content. Additionally, Article 24 (5) of the DSA requires providers of online platforms, which are a type of hosting service, to send all their statements of reasons to the Commission's DSA Transparency Database for collection."* And: *"The DSA Transparency Database only collects statements of reasons from online platforms, a subset of hosting services."*
- E6 (via WebFetch): *"providers of online platforms need to submit these statements of reasons to the DSA transparency database."*

**Answer from the text:** online platforms only, not hosting services generally. Micro and small online platforms are excluded by Art. 19. Art. 17 statements *to the affected rider* still apply to every hosting service.

---

## 4. What exists today (repository, `origin/main`, and issues)

- **Instance moderation (#83, shipped as #891):** block, report (by rider id, 5 per hour, signed-in only), hide display name, suspend or unsuspend, and an append-only log (`docs/moderation.md`). The doc says: *"Riders' rides are not shown to other riders on the instance yet, so the only content another rider can see is a name."*
- **Moderator roles:** the doc still says owner plus deputy (`OYL_INSTANCE_DEPUTY_KEY`). **#905 (open, 2026-09-30) makes it one moderator** and flags that a report about the only moderator stays open for ever.
- **Registration:** default `closed`; the project's image uses `approval`; 18+ self-declaration is stored with its date, and no date of birth is collected (`docs/moderation.md`, #775).
- `docs/moderation.md` "Before you open your instance to the public" already says: *"The UK Online Safety Act and EU Digital Services Act assessments come before public rooms go live. If you run your own instance, you owe your own."* This matches s.226: each operator is the provider of their own instance.
- There is **no terms of service document** and no appeal route. There is no non-account notice route. The privacy-policy revision is #778 (open).
- Related open issues: #886, #887, #788 (gated on both), #775, #83, #905, #899, #778, #873/#794 (Discord voice; spike 0018 on main).
- **#887 says "a named deputy (ruling Q13)"; #905 has superseded that.** #886 does not mention s.10(3A), s.20A (intimate image content reports, 48 hours, in force 29.6.2026) or s.66 (NCA CSEA reporting, in force 7.4.2026). #887 does not mention Arts 11–14 or 18.

## 5. Pages that could not be read, with the exact failure

1. **Ofcom Children's Access Assessments Guidance PDF**, https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/main-document/childrens-access-assessments-guidance.pdf: WebFetch *"HTTP 403 Forbidden"*; Tavily extract returned an empty result. A guessed alternative path (…/statement-age-assurance-and-childrens-access/childrens-access-assessments-guidance.pdf) also returned nothing. **Not read.** Ofcom's HTML page (O4) and toolkit (O5) were read instead.
2. **Ofcom Risk Assessment Guidance, current version** (`…risk-assessment-guidance-and-risk-profiles.pdf?v=419933`): WebFetch 403; Tavily empty. The URL without `?v=` returned a document headed *"Published 16 December 2024"*. The documents page (search snippet) lists *"Risk Assessment Guidance and Risk Profiles (Updated) • PDF • 860.69 KB • 25 June 2026"*. **The version read may be superseded.**
3. **Ofcom Record-Keeping and Review Guidance** (`…/updates/record-keeping-and-review-guidance.pdf?v=420034` and the version without `?v=`): Tavily returned empty for both. **Not read.** So whether Ofcom has made any s.23(7) exemption is **unknown**.
4. **Ofcom Codes PDF, direct**: `curl` returned `403 text/html`; WebFetch *"HTTP 403 Forbidden"*. Read through Tavily extraction instead (O1).
5. **Ofcom HTML pages by `curl`** (CAA duties page, illegal content duties page): `403`. Read through Tavily instead.
6. **Ofcom small-services page**: extraction dropped the bullet list after *"These include:"*. **That list was not read.**
7. **EUR-Lex by `curl`**: HTTP `202` with a zero-byte body. Read through Tavily. `CELEX:32000L0031` TXT/HTML via Tavily returned empty; the ELI URL worked.
8. **DSA consolidated versions and any amendment after 2022**: not checked. An EU "KIDS ACT" proposal is mentioned **second-hand** in an Osborne Clarke snippet (S1), not read.
9. **transparency.dsa.ec.europa.eu/page/faq**: WebFetch *"HTTP 404 Not Found"*. The Commission FAQ (E5) was read instead.
10. **Ofcom scope checker and compliance toolkits**: interactive, not run.
11. **CJEU case law on remuneration and economic activity**: not read.
12. **OSA ss.11–12** (children's risk assessment and safety duties): not read.
13. **OSA s.22** (freedom of expression and privacy): not read. It is referenced by s.21(4)(b)(iii) and ICU D12.

## 6. Requirements extracted, each tied to a source

- **R1.** A dated, written illegal content risk assessment covering each s.9(5)(a)–(h) item, in Ofcom's four steps, recorded per s.23(2) and O9 Table 8. It should list the features in scope: display names, group-ride routes, results, room listing, room chat if any, and the Discord link. It should consult the **current** Risk Profiles, including "User profiles" and "Posting or sending location information". [L4, L8, O9]
- **R2.** A written record of which Codes measures apply and are adopted. For a small, non-multi-risk service the minimum is A2, C1, C2, D1, D2, D7, D9–D13, G1, G3 and H1, or recorded alternatives per s.23(4). [O1, L8]
- **R3.** A children's access assessment that does **not** treat 18+ self-declaration as age assurance (s.35(2), s.230(4), O6 ¶3.14). If Stage 2 concludes "not likely", it must record *"the steps taken and the detailed evidence"*. Repeat within one year. [L9, L11, O4]
- **R4.** Reporting for users **and affected persons** (non-users) of illegal content, including intimate image content reports (s.20A, 48-hour takedown under s.10(3A)). [L5, L6]
- **R5.** A complaints procedure covering s.21(4)(a)–(e), including appeals against takedown or suspension (ICU D9/D10), described in the terms of service (s.21(3)). [L7, O1]
- **R6.** Terms of service meeting s.10(5)–(8) and ICU G1/G3. If the DSA applies, they also meet Art. 14(1)–(4). [L5, O1, E1]
- **R7.** A way to report CSEA to the NCA if detected (s.66). [L13]
- **R8.** If the DSA applies: an Art. 16 mechanism for **any individual or entity**, by electronic means, able to carry (a)–(d). Acknowledgement (16(4)), decision notice with redress (16(5)), and timely, non-arbitrary processing (16(6)). [E1]
- **R9.** If the DSA applies: statements of reasons with all of 17(3)(a)–(f), where electronic contact details are known. [E1]
- **R10.** If the DSA applies: points of contact under Arts 11 and 12, an Art. 13 legal representative, and Art. 18 threat-to-life notification. [E1]
- **R11.** A procedure written for **one moderator** (#905), including what happens to a notice or complaint about the moderator.

## 7. Open questions for the owner or a lawyer

1. **Scope, EU (decisive):** is a free, non-commercial, individually run instance an "information society service" ("normally provided for remuneration"; e-Commerce recital 18 "in so far as they represent an economic activity"), and is the owner an "enterprise" under Rec. 2003/361? *Settled by:* a lawyer, with the CJEU case law read.
2. **EU substantial connection:** does the app's availability in EU Play stores (recital 8) plus EU riders make the project "offer services in the Union"? Would the owner geo-restrict? *Settled by:* the owner (facts) and a lawyer.
3. **Art. 13 legal representative:** if the DSA applies, who is it, and can the project bear it? *Owner.*
4. **Online platform or not:** does recital 14's "human decision" (approval registration) keep the project's instance outside "online platform"? *Lawyer.*
5. **UK timing:** is the instance *already* a regulated U2U service (names plus group rides)? If so, when was "the first day" under Sch.3? *Lawyer, with the owner supplying facts.*
6. **UK links:** "significant number" and "target market" under s.4(5). *Lawyer.*
7. **Children's access conclusion at Stage 2** with self-declaration plus approval: can "not likely to be accessed by children" be supported, and what evidence would be recorded? If "likely", the children's risk assessment and ss.11–12 duties follow and were not researched. *Owner and lawyer.*
8. **A2 and governance for a sole individual:** how to record the "most senior governance body". *Owner.*
9. **Art. 17(2) contact details:** does an in-app channel count, given the instance holds no email? *Lawyer.* And what channel delivers statements of reasons? *Owner*; filed as [#910](https://github.com/openzigs/onyourleft/issues/910).
10. **Room chat:** is any built or planned? It changes the risk factors (group messaging) and triggers s.9(4). *Owner.*
11. **The current (25 June 2026) Ofcom Risk Assessment Guidance, the CAA Guidance PDF, and the Record-Keeping Guidance** must be read by a person with a browser before the assessment is signed off. They could not be fetched here.
12. **#887's text names a deputy**, which #905 reverses. The issue body needs a revision block. *Owner.*

## 8. What was made from this reading

This section was added when the reading was committed, and records where it went. It decides
nothing.

- **Drafts pending the owner's approval**, each marked as such and not legal advice:
  [the illegal content risk assessment](../moderation/illegal-content-risk-assessment.md),
  [the children's access assessment](../moderation/childrens-access-assessment.md),
  [the notice-and-action and complaints procedure](../moderation/notice-and-action.md),
  [the statement-of-reasons templates](../moderation/statement-of-reasons.md) and
  [the DSA scope reading](../moderation/dsa-scope.md).
- **Product changes those drafts imply**, filed and not built:
  [#907](https://github.com/openzigs/onyourleft/issues/907) (a notice route without an account),
  [#908](https://github.com/openzigs/onyourleft/issues/908) (a legal and contact page),
  [#909](https://github.com/openzigs/onyourleft/issues/909) (terms of service),
  [#910](https://github.com/openzigs/onyourleft/issues/910) (statements of reasons),
  [#911](https://github.com/openzigs/onyourleft/issues/911) (complaints and appeals),
  [#912](https://github.com/openzigs/onyourleft/issues/912) (a record of each notice) and
  [#913](https://github.com/openzigs/onyourleft/issues/913) (action on a specific item).
