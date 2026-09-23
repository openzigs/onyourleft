# Spike 0008: Does the EU MDR, or the UK regime, qualify this camera analysis as a medical device?

- **Date read**: **2026-09-23.** Every passage quoted below was read on that day from the document
  named beside it, fetched to disk and hashed. Nothing here is taken from a search-result summary,
  a vendor explainer, a consultancy blog or a regulator's press release — where something *is*
  second-hand it is marked so in the sentence that carries it
- **Issue**: [#495](https://github.com/openzigs/onyourleft/issues/495) Q2, which is
  [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md)'s own open question 2. Parent
  [#377](https://github.com/openzigs/onyourleft/issues/377)
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an
  ADR and does not decide anything — it is a dated measurement that an ADR or an issue may then
  rest on, and it ages the way a measurement does."* §9 is a posture; the decision is the owner's,
  and writing this does not by itself clear the gate the owner's answer created
- **Number**: **0008**, taken after reading `docs/spikes/` **and** every open pull request's files
  on 2026-09-23 — which is the check [#493](https://github.com/openzigs/onyourleft/issues/493)
  exists to replace with a rule, and which is implemented in the same pull request as this document.
  0005 is claimed twice at the time of writing ([#471](https://github.com/openzigs/onyourleft/pull/471)
  against `main`'s own), and 0006 was claimed twice on 2026-09-22; neither is renumbered here, for
  `CLAUDE.md` §7's reason

> ## ⚠️ This is not legal advice, and it is not a regulatory opinion
>
> [ADR 0007](../adr/0007-patent-posture.md) D1 says it of itself, [spike 0005](0005-live-racing-patent-read.md)
> repeats it, [spike 0006](0006-camera-bike-fit-patent-read.md) repeats it again because it reached a
> favourable conclusion — and this one repeats it for a third reason. **It reads a Regulation, a
> non-binding guidance, a national regulator's guidance and a national statutory instrument, and
> reaches a conclusion about how they apply to a product that does not exist yet.** That is four
> layers of judgement, each of which a qualified person would make differently. **No lawyer has
> reviewed this and none was bought** — [#495](https://github.com/openzigs/onyourleft/issues/495)'s
> answer was *"read the rules first-hand"*, not *"buy an opinion"*. §9 names the questions a lawyer
> is worth asking. **Anyone citing this spike as clearance is misusing it.**

---

## 1. What was read, from where, and what it hashes to

| # | Document | Fetched from | Bytes on disk | SHA-256 |
|---|---|---|---|---|
| **A** | **Regulation (EU) 2017/745 (MDR)**, the text as adopted (OJ L 117, 5.5.2017) | `http://publications.europa.eu/resource/celex/32017R0745`, XHTML | 1 708 372 | `81790aaa50163ca27e3794c82cfa8cee875cae2dace3ad3ab9e72d9f890e94f5` |
| **B** | **Regulation (EU) 2017/745, consolidated text as at 2024-07-09** | `http://publications.europa.eu/resource/celex/02017R0745-20240709`, XHTML, with `Accept-Language: eng` | 1 621 405 | `cab83524351bf7715d6e80e5fd0be92bfb9f7c830f21851a71898aec371ea888` |
| **C** | **MDCG 2019-11 Rev.1**, *Guidance on Qualification and Classification of Software in Regulation (EU) 2017/745 – MDR and Regulation (EU) 2017/746 – IVDR*, **June 2025 rev.1** | `https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf`, PDF | 489 666 | `ed60b2084a91648bf483eb6c33641e0635e51bfb9712f889124c279b1885f38d` |
| **D** | **MDCG 2019-11**, the **superseded October 2019** text — read only to establish §2's correction | `https://ec.europa.eu/docsroom/documents/37581/attachments/1/translations/en/renditions/native` **and** `https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf`, PDF | 280 434 | `39fbf2011e289521e0db50f084ea2186c02a5de8803fff4351f5dc0bb2876906` — ⚠️ **the same digest from both URLs** |
| **E** | **MHRA**, *Guidance: Medical device stand-alone software including apps (including IVDMDs)*, **v1.10f** — published 8 August 2014, page last updated **1 July 2023** | `https://assets.publishing.service.gov.uk/media/64a7d22d7a4c230013bba33c/Medical_device_stand-alone_software_including_apps__including_IVDMDs_.pdf`, PDF | 1 557 769 | `4aa0c040ae8e0d473aa48761d9fffd8ff099f96483ef307357403892fda6022e` |
| **F** | **The Medical Devices Regulations 2002** (SI 2002/618, as amended), **regulation 2** — the UK definition | `https://www.legislation.gov.uk/uksi/2002/618/regulation/2`, HTML | 262 014 | `db02c690f50a93d2e997abdbea5bf2248aba3274e67a9e0a279f514345f03e70` |
| **G** | **MHRA**, *Regulating medical devices in the UK* — guidance page, published 31 December 2020, **last updated 20 February 2026** | `https://www.gov.uk/guidance/regulating-medical-devices-in-the-uk`, HTML | 185 772 | `012519e76cb403c8dfd144fa9d1bff315463f132c58509fdd62b2d50325e9ad9` |

⚠️ **EUR-Lex's own web front end could not be read from this environment and the Publications Office
Cellar could.** `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32017R0745` answered
**HTTP 202 with a zero-byte body** on every attempt, with and without a browser user agent — which is
a bot defence rather than an outage, and a reader reproducing this should expect it. The Cellar
resource URIs in the table are the route that worked, and **they need `Accept-Language: eng`**: without
it, three of the four returned `HTTP 400` with the body *"Invalid content type CONTENT_STREAM for WORK
… without lang"*, which reads like a missing document and is not one. §10 has the commands.

### What was **not** read, stated as the gap it is

- **No lawyer.** See the box above.
- **The EU Artificial Intelligence Act (Regulation (EU) 2024/1689) was not read at all.** #377's
  Phase C contemplates a vision-language model. Whether that is a general-purpose AI system, whether
  any obligation attaches to a deployer who is also a natural person using it on themselves, and how
  Article 6's high-risk route interacts with a product that is *not* a medical device, are all
  unexamined. ⚠️ **This is the largest single gap in this document** and it is a bigger one than the
  MDR question for a camera product in 2026.
- **No consumer-protection or advertising law**, in any jurisdiction — the same gap
  [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) records for the US. A claim can be
  lawful under a device regime and still be an actionable misrepresentation.
- **No national implementing law of any Member State**, and no Member State's own guidance.
- **The Medical Devices (Post-Market Surveillance Requirements) Regulations 2024** were seen and not
  read. They bite on a device; nothing here concludes this is one.
- **MDCG 2020-1, MDCG 2019-16, MDCG 2023-4 and IMDRF N81** are cited by document C and were not read.
- **Health Canada, the TGA, Swissmedic and every other regime** — unread, as before. Two more
  jurisdictions is not all of them, and #495's answer did not claim it was.
- **Documents A and B were read for two provisions and searched for a third.** Neither was read end
  to end; §3 says exactly which text was extracted.

---

## 2. ⚠️ The correction this reading forces, in [ADR 0007](../adr/0007-patent-posture.md) D7's shape

**The MDCG software guidance is at Rev.1, dated June 2025. The European Commission's own website
still serves the superseded October 2019 text at a URL a search engine returns, and both are live.**

[ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) names *"its MDCG software-qualification
guidance"* without a revision, which was correct at the time and is the shape of citation this
correction is about. What was measured on 2026-09-23:

| | |
|---|---|
| `https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf` | **October 2019.** 280 434 bytes, digest `39fbf201…`, **11 477 words** of extracted text |
| `https://ec.europa.eu/docsroom/documents/37581/attachments/1/translations/en/renditions/native` | **October 2019.** ⚠️ **Byte-identical to the above — the same SHA-256** |
| `https://health.ec.europa.eu/document/download/b45335c5-…_en?filename=mdcg_2019_11_en.pdf`, linked as *"MDCG 2019-11 rev.1"* from the Commission's own MDCG index page | **Rev.1, cover dated *"October 2019 / June 2025 rev.1"*.** 489 666 bytes, digest `ed60b208…`, **13 792 words** |

**The passage this spike turns on is in Rev.1 and not in the 2019 document** — §4 quotes it — so a
reader who fetched "MDCG 2019-11" from either of the first two URLs would have read a document that
does not contain the example nearest to this product. That is the same failure
[ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) records about an FDA sentence quoted from
somewhere other than the document, arrived at from the other direction: here the document is real,
the URL is the regulator's own, and it is the wrong revision. **The lesson is that a guidance
citation needs a revision and a date, not a number.**

---

## 3. The EU: Article 2(1), and the one limb that is close

### 3.1 The definition, verbatim

From document **A**, Article 2, point (1), and **identical in document B** — see §3.3:

> *‘medical device’ means any instrument, apparatus, appliance, software, implant, reagent, material
> or other article intended by the manufacturer to be used, alone or in combination, for human
> beings for one or more of the following specific medical purposes:*
>
> — *diagnosis, prevention, monitoring, prediction, prognosis, treatment or alleviation of disease,*
>
> — *diagnosis, monitoring, treatment, alleviation of, or compensation for, an injury or disability,*
>
> — *investigation, replacement or modification of the anatomy or of a physiological or pathological
> process or state,*
>
> — *providing information by means of in vitro examination of specimens derived from the human
> body, including organ, blood and tissue donations,*
>
> *and which does not achieve its principal intended action by pharmacological, immunological or
> metabolic means, in or on the human body, but which may be assisted in its function by such means.*

Two further provisions of the same Regulation bear directly, and are quoted because the analysis
below rests on them rather than on the definition alone.

**Recital (19)**, which is the software recital:

> *It is necessary to clarify that software in its own right, when specifically intended by the
> manufacturer to be used for one or more of the medical purposes set out in the definition of a
> medical device, qualifies as a medical device, while software for general purposes, even when used
> in a healthcare setting, or software intended for life-style and well-being purposes is not a
> medical device. The qualification of software, either as a device or an accessory, is independent
> of the software's location or the type of interconnection between the software and a device.*

**Article 2, point (12)**, which is what makes this a question about our own words:

> *‘intended purpose’ means the use for which a device is intended according to the data supplied by
> the manufacturer on the label, in the instructions for use or in promotional or sales materials or
> statements and as specified by the manufacturer in the clinical evaluation;*

### 3.2 Charted against what this product claims after #495 Q1

| Limb of Article 2(1) | Does this product's intended purpose fall in it? |
|---|---|
| *diagnosis, prevention, monitoring, prediction, prognosis, treatment or alleviation of **disease*** | **No, and only because ADR 0030 R5 says so.** R5 forbids naming a disease, condition, injury, symptom or a body part's health *in any tense, including as something avoided* — which is exactly the *prevention* verb in this limb. ⚠️ **The whole distance from this limb is carried by one wording rule**, and §4.3 is why that is thinner than it sounds |
| *diagnosis, monitoring, treatment, alleviation of, or compensation for, an **injury or disability*** | **No**, same rule. *"Reduces your risk of ITB syndrome"* — R5's own forbidden illustration — is this limb almost word for word |
| ***investigation, replacement or modification of the anatomy** or of a physiological or pathological process or state* | ⚠️ **This is the close one, and it is close on its face.** A camera measuring where a rider's knee is at the bottom of the pedal stroke is, in ordinary English, an investigation of the anatomy. What keeps it out is not the words of the limb but the chapeau — *"for one or more of the following **specific medical purposes**"* — read with Recital (19)'s *"life-style and well-being purposes"* exclusion and with document C's §4. **It is a purpose test, not a technology test**, and this row is where a lawyer's answer could differ from this document's |
| *providing information by means of **in vitro examination** of specimens* | **No.** Nothing is examined outside the body |

And the closing words of the definition — *"does not achieve its principal intended action by
pharmacological, immunological or metabolic means"* — are satisfied trivially and in the direction
that **does not help**: failing them is what takes a product *out* of the device definition and into
the medicinal-product one, so passing them is neutral.

### 3.3 The consolidated text was checked, rather than assumed

An asserted stability is only as good as the comparison that failed to find a change, so document B
was fetched and the two provisions extracted from both and compared as strings:

| Provision | Document A (OJ, 2017-05-05) | Document B (consolidated, 2024-07-09) |
|---|---|---|
| Article 2(1), from *‘medical device’ means* to *The following products shall also be deemed* | 905 characters | **Byte-identical** |
| Annex VIII, 6.3 Rule 11, whole rule | 795 characters | **Byte-identical** |

So **every amendment to the MDR in force on 2024-07-09 leaves both provisions exactly as adopted**.
⚠️ **What this does not establish**: anything about amendments after 2024-07-09 — the consolidated
text is only as current as the Publications Office's consolidation — and nothing about the rest of
the Regulation, which was not compared. Regulations (EU) 2020/561, 2023/607 and 2024/1860 were
fetched and **not read**; the comparison above is what stands in for reading them, and it stands in
only for these two provisions.

---

## 4. The EU: MDCG 2019-11 Rev.1, and the example that is one adjective away

Document **C** is not law and says so on its own cover:

> *The document is not a European Commission document and it cannot be regarded as reflecting the
> official position of the European Commission. Any views expressed in this document are not legally
> binding and only the Court of Justice of the European Union can give binding interpretations of
> Union law.*

It is nonetheless what notified bodies and national authorities work from, and three passages decide
how this product reads.

### 4.1 The sentence that puts this product outside, by name

§3.1, *Introduction to qualification criteria*:

> *In addition, software only intended for non-medical purposes (excluding MDR Annex XVI devices),
> such as invoicing, staff planning, e-mailing, web or voice messaging, data parsing, word
> processing, and back-up, **wellness or fitness apps, do not qualify as MDSW**.*

⚠️ **This is the first place in the whole of #377's regulatory work where the wider reading of #495
Q1 makes the position stronger rather than weaker.** [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md)'s
own amendment records that claiming a fitness benefit **narrows** the US margin, because the
FDA's general-wellness carve-out is conditional on six things all holding at once. In the EU it does
the opposite: *"wellness or fitness apps"* is a named exclusion, and a product that claims a fitness
benefit is describing itself in the guidance's own words. A product that claimed **nothing** — the
narrow reading ADR 0030's body took — would have to be characterised by somebody else before it
could be excluded by this sentence.

The same section is equally clear that the test is purpose rather than sophistication:

> *Software must have a medical purpose on its own to be qualified as a MDSW (MDSW). It should be
> noted that the intended purpose, as described by the manufacturer of the software is relevant for
> the qualification and classification of any device.*

and, on what *does* pull software in:

> *However, software which is intended to process, analyse, interpret, calculate, create or modify
> medical information may be qualified as a MDSW if the creation or modification of that information
> is governed by a medical intended purpose.*

⚠️ Note **"process, analyse, interpret, calculate"**. Every one of those verbs describes what a pose
estimator does to a photograph. The qualifier that saves it is *"if … governed by a medical intended
purpose"*, and the guidance's own following sentence — *"altering the representation of data for
embellishment/cosmetic or compatibility purposes does not readily qualify the software as MDSW"* —
is the nearest thing in the document to a permission for a picture with nothing claimed about it.

### 4.2 The two examples that are nearest, and what separates each from this product

Both are **MDSW** in the guidance's own list. Neither is far away.

| Document C's example | What separates it from #377's product |
|---|---|
| §3.2, Note 1: *"MDSW that uses the data of a patient with a specific **musculoskeletal pathology** (e.g. X-rays, range of motion, weight, age, etc.) and is intended to **alleviate pain** associated with the musculoskeletal pathology by **recommending personalised rehabilitation exercises** to be performed."* | **Three things, and all three are already refused for other reasons.** It names a pathology (R5); it claims alleviation of pain (R5); and it recommends what to do (R7, D-5). ⚠️ *"range of motion"* is in its input list and is not what separates them — the **inputs overlap** and the **claims do not**, which is the whole shape of ADR 0030 |
| §4.2.1, sub-rule 11a: *"a device intended to **prevent the risk of illnesses or pathologies** by analysing physiological parameters (e.g. **placement of the dorsal vertebrae**, analysis of arterial stiffness, etc.) can be considered as a device providing information which is used to take decisions with diagnosis purpose (potential detection of pathologies) and in this case is in **class IIa**."* | ⚠️ **One thing. The words *"intended to prevent the risk of"*.** *Placement of the dorsal vertebrae* is posture measured from anatomy, which is what this product measures. **Nothing else in that sentence distinguishes the two** |

### 4.3 ⚠️ The finding, stated as plainly as it can be

**In the EU, the distance between this product and a class IIa medical device is carried by
[ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) R5, and by very little else.**

R5 was written as a wording rule with a US regulator's disqualifier list behind it. This read
promotes it: a single sentence anywhere in this product's *intended purpose* — which Article 2(12)
defines as *"the label, the instructions for use or in promotional or sales materials or
statements"* — claiming that watching your position prevents injury would place the product inside
document C's own worked class IIa example. **That is not a wording slip with a wording consequence.
It is the difference between a self-published app and a device needing a notified body.**

⚠️ **And Article 2(12) reaches further than any gate this repository has.**
[ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) D-8's two source scans cover
`apps/web/src`. The Google Play store listing, `README.md`, the repository description, a release
note, the About screen's prose and an issue title are all *"promotional or sales materials or
statements"* on the definition's face, and **none of them is scanned by anything**. That gap is real,
it is new, and §8 files it rather than leaving it in a paragraph.

---

## 5. The EU: Annex VIII Rule 11 — what the class would be if it qualified

From documents **A** and **B**, Annex VIII, Chapter III, §6.3, verbatim and identical in both:

> **Rule 11**
>
> *Software intended to provide information which is used to take decisions with diagnosis or
> therapeutic purposes is classified as class IIa, except if such decisions have an impact that may
> cause:*
>
> — *death or an irreversible deterioration of a person's state of health, in which case it is in
> class III; or*
>
> — *a serious deterioration of a person's state of health or a surgical intervention, in which case
> it is classified as class IIb.*
>
> *Software intended to monitor physiological processes is classified as class IIa, except if it is
> intended for monitoring of vital physiological parameters, where the nature of variations of those
> parameters is such that it could result in immediate danger to the patient, in which case it is
> classified as class IIb.*
>
> *All other software is classified as class I.*

Document C splits it into three sub-rules and then says the thing that matters:

> *11a: (3 first paragraphs of Rule 11) intended to provide information which is used to take
> decisions with diagnostic or therapeutic purposes;*
> *11b: (Paragraph 4 of Rule 11) intended to monitor physiological processes or parameters;*
> *11c: (Paragraph 5 of Rule 11) all other uses.*

and, of 11a:

> *The wording "intended to provide information which is used to take decisions with diagnosis or
> therapeutic purposes" describes, in very general terms, the "mode of action" which is
> characteristic of all MDSW. **Therefore, this sub-rule is generally applicable to all MDSW**
> (excluding those MDSW that have no medical purpose).*

⚠️ **So the comforting reading of Rule 11 — *"all other software is class I"* — is not available.**
The guidance treats 11c as a residue that a qualifying MDSW rarely lands in, and says 11a is
*generally applicable*. **The honest conditional is: if this product qualified at all, the working
assumption is class IIa**, which means a notified body, a quality management system and a clinical
evaluation. There is no version of qualifying that is cheap.

**That asymmetry is the argument for the rules ADR 0030 already has.** Qualification is binary and
its consequence is large; every rule that keeps the product's stated purpose out of Article 2(1) is
worth more than it looks.

---

## 6. The UK: a narrower definition, a lighter class, and a regime in motion

### 6.1 Great Britain is not under the MDR, and Northern Ireland is

From document **G**, verbatim:

> *Since 26 May 2021, the EU Medical Devices Regulation (Regulation 2017/745) (EU MDR) has applied in
> EU Member States and Northern Ireland. The in vitro Diagnostic Medical Devices Regulation
> (Regulation 2017/746) (EU IVDR) has applied in EU Member States and Northern Ireland since 26 May
> 2022. As these EU regulations did not take effect during the transition period, they were not EU
> law automatically retained by the EU (Withdrawal) Act 2018 and **therefore do not apply in Great
> Britain**.*

> *Devices are regulated under the Medical Devices Regulations 2002 (SI 2002 No 618, as amended) (UK
> MDR 2002) which, prior to the end of the transition period (following the UK's departure from the
> EU), gave effect in UK law to the directives listed below…*

**So the UK has diverged, and the divergence is that it has stayed still.** Great Britain is on the
old Directive-derived rules; Northern Ireland is on the MDR. ⚠️ **A single APK on Google Play
worldwide is placed on the Northern Ireland market as readily as on the Irish one**, so the EU
analysis in §3 to §5 is not avoidable by a UK/EU split. §9 asks a lawyer about exactly that.

The same page records the transitional arrangements, verbatim:

> *general medical devices compliant with the EU medical devices directive (EU MDD) or EU active
> implantable medical devices directive (AIMDD) with a valid declaration and CE marking can be
> placed on the Great Britain market up until the sooner of expiry of certificate or 30 June 2028*

> *general medical devices including custom-made devices, compliant with the EU medical devices
> regulation (EU MDR) and IVDs compliant with the EU in vitro diagnostic medical devices regulation
> (EU IVDR) can be placed on the Great Britain market up until 30 June 2030.*

and that the future is not settled:

> *The government has announced that it will consult on indefinite recognition of CE marked medical
> devices.*

⚠️ Secondary reporting says a consultation on indefinite recognition is open in early 2026 and that
a further statutory instrument introducing **pre-market** requirements is expected in 2026. **Neither
was read**, and neither is relied on here; they are recorded because a reader of this document in a
year needs to know the regime was moving when it was written.

### 6.2 The UK definition is narrower than the MDR's, in two ways that matter

From document **F**, regulation 2(1), verbatim:

> *"medical device" means any instrument, apparatus, appliance, software, material or other article,
> whether used alone or in combination, together with any accessories, including the software
> intended by its manufacturer to be used specifically for diagnosis or therapeutic purposes or both
> and necessary for its proper application, which—*
>
> *(a) is intended by the manufacturer to be used for human beings for the purpose of-*
>
> *(i) diagnosis, prevention, monitoring, treatment or alleviation of disease,*
>
> *(ii) diagnosis, monitoring, treatment, alleviation of or compensation for an injury or handicap,*
>
> *(iii) investigation, replacement or modification of the anatomy or of a physiological process, or*
>
> *(iv) control of conception; and*
>
> *(b) does not achieve its principal intended action in or on the human body by pharmacological,
> immunological or metabolic means, even if it is assisted in its function by such means…*

| Difference from MDR Article 2(1) | Does it help this product? |
|---|---|
| Limb (i) has **no "prediction" and no "prognosis"** | **Marginally.** Both are refused anyway — R1's *"past, about this ride"* tense rule already forbids a future claim |
| Limb (iii) covers *"a physiological process"* and **not** *"or pathological process or state"* | **No.** The close limb is *"investigation … of the anatomy"*, and that is present in both regimes in identical words |
| *"injury or handicap"* rather than *"injury or disability"* | **No**, a drafting vintage rather than a narrowing this product could use |
| **No Rule 11.** The UK classification rules are the Directive's | **Yes, substantially** — see §6.3 |

### 6.3 MHRA's own position, and the classification that follows

Document **E**, v1.10f. Three passages, verbatim:

> *The monitoring of general fitness, general health and general wellbeing is not usually considered
> to be a medical purpose*

> *Apps and software for monitoring sport or fitness purposes, e.g. heart rate, are not considered to
> be medical devices. **However, in some specific cases, where the intention is to investigate the
> physiological processes they may be.***

> *Rule 12 - All other active devices are class I.*

⚠️ **The caveat in the second quotation is limb (iii) again, in MHRA's own voice**, which is the
second independent arrival at the same conclusion: across both regimes, the risk to this product is
not *"does it say something medical"* — ADR 0030 has that covered — it is **"is measuring a body from
a photograph an investigation of the anatomy or of a physiological process"**. That is the question
for counsel, and it is §9's first.

**And the consequence differs enormously between the two.** In Great Britain a qualifying standalone
software product of this shape falls to Rule 12 and is **class I, self-declared**; document G says
so directly — *"Manufacturers of Class I medical devices and general IVDs can self-declare the
conformity of their devices against the UK MDR 2002"*. In the EU the same product is class IIa under
Rule 11 and needs a notified body. **The jurisdiction that is cheap to get wrong is the UK; the one
that is expensive is the EU** — and Northern Ireland is on the expensive one.

---

## 7. What this changes for ADR 0030's rules: nothing loosens, and two things get heavier

| ADR 0030 rule | What this read does to it |
|---|---|
| **R5** — no disease, condition, injury, symptom or body part's health, *"in any tense, including as something avoided"* | ⚠️ **Promoted from a wording rule to the load-bearing one.** §4.3: it is what separates this product from document C's worked class IIa example. It was written with the FDA's disqualifier list in mind and it is doing more work in the EU than in the US |
| **D-5** — no equipment, no component, no direction to move one | ⚠️ **Second-heaviest, and it now has a third independent justification.** It already had a product reason and a patent reason ([spike 0006](0006-camera-bike-fit-patent-read.md)). Document C's musculoskeletal example turns on *recommending* something to do; not recommending is what keeps this product out of it. That is three unrelated reasons for one rule, which is [ADR 0007](../adr/0007-patent-posture.md) D2's ideal shape |
| **R7** — no prompt to act, no alert | Unchanged and reinforced. The same example, same reason |
| **D-3** — no absolute joint angle, ever | **Unchanged, and neither regime supplies a third reason for it.** Worth saying plainly: D-3's two reasons stay two. The EU/UK read does not add to it and does not weaken it |
| **D-4** — nothing in the frontal plane | **Unchanged**, and untouched by anything read here |
| **D-6** — literature range as cited prose, never a band the rider sits in | Unchanged. ⚠️ Placing a rider against a published range is the closest this product could come to *"potential detection of pathologies"* without naming one, which is document C's own gloss on sub-rule 11a |
| **D-7** — the live coach's silence rule | Unchanged. An in-ride utterance is still the riskiest surface, and neither document read here softens that |
| **D-8** — what a machine checks | ⚠️ **Found insufficient in a new way**, and it is §8's filing: Article 2(12)'s *intended purpose* includes promotional and sales material, and D-8's scans cover `apps/web/src` only |

**No rule in ADR 0030 is loosened by this read, and this document does not propose loosening one.**
That matters because #495 Q1 widened the *claim*, and a reader could reasonably expect a wider claim
plus a favourable regulatory read to add up to a permission. It does not: §4.1 is favourable
**because** the product stays inside *"wellness or fitness apps"*, and it stays inside that by not
saying the things ADR 0030 already forbids.

---

## 8. The gap this read found in this repository's own gates

**Stated as a finding rather than a paragraph, because it is actionable and nothing covers it
today.**

> Article 2(1) qualification turns on **intended purpose**, and Article 2(12) defines that as *"the
> data supplied by the manufacturer on the label, in the instructions for use or in **promotional or
> sales materials or statements**"*. MDCG 2019-11 Rev.1 §3 puts the same point in operational terms:
> *"Crafting a well-defined and clear intended purpose is paramount … The intended purpose must
> comprehensively describe all functionalities of the MDSW that serve a medical purpose, leaving no
> ambiguity regarding its scope and use."*

[ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) D-8's two mechanical checks scan
`apps/web/src`. The surfaces that Article 2(12) actually names are:

| Surface | Scanned by anything today? |
|---|---|
| The Google Play store listing — short and full description | **No** |
| `README.md`, and the repository's GitHub description | **No** |
| A GitHub release note | **No** |
| The About screen's prose, and the privacy policy's description of the feature | **No** — `apps/web/src` is scanned for units and would be scanned by D-8's rules, but `docs/privacy-policy.md` is not |
| An issue or pull request title in a public repository | **No**, and it is genuinely arguable whether that is a *"statement"* by the manufacturer |

**The recommendation is not to build a scanner over prose.** It is that whoever implements
[#388](https://github.com/openzigs/onyourleft/issues/388) treats the *store listing and the README*
as product surfaces subject to D-2's table, and that whoever writes the listing reads that table
first. Whether that becomes a rule is a decision, and `CLAUDE.md` §4l's own note about the
cost-model gate's blind spot applies exactly: *"machine-checking a sentence means pinning its
wording and a gate that forbids rewording a paragraph gets deleted."*

---

## 9. Posture, and the questions for counsel

**This document decides nothing.** What it supports, if the owner wants a one-line summary:

> **Nothing read here blocks the camera work under ADR 0030's rules as they stand — and the margin
> is thinner than the US read produced, because in the EU it rests on a single wording rule rather
> than on a product that makes no claim at all.**

Three questions, specific, on [ADR 0007](../adr/0007-patent-posture.md)'s model. None is *"is this
legal"*.

**Question A — does *"investigation … of the anatomy or of a physiological process"* reach a
differences-only sagittal measurement made from one uncalibrated camera, where no absolute value is
rendered and no condition is named?** This is the limb both regimes share in identical words, it is
the one MHRA's own caveat points at, and it is the question on which this document's conclusion
could simply be wrong. Worth asking **before** [#382](https://github.com/openzigs/onyourleft/issues/382)
is built, and it is the EU/UK form of [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md)'s
Question B.

**Question B — how much wording latitude is there between *"this helps you ride better"* and MDCG
2019-11 Rev.1's *"intended to prevent the risk of illnesses or pathologies by analysing physiological
parameters (e.g. placement of the dorsal vertebrae…)"*?** #495 Q1 authorises a fitness-benefit claim.
§4.3 says that claim is what keeps the product inside a named exclusion — and one sentence in a store
listing is what would move it into a worked class IIa example. A lawyer can say where the line sits;
an engineer can only say the two sentences are close.

**Question C — does distributing one build worldwide through Google Play place the product on the
Northern Ireland market, and therefore under the EU MDR, regardless of the Great Britain position?**
§6.1 makes the GB/NI split real. This is a distribution question with a regulatory answer, and it is
cheap to ask.

Three things a lawyer is **not** being asked, because nothing turns on them: whether MDCG 2019-11 is
binding (it says of itself that it is not); whether the UK will change its regime (it says it will,
and nothing here depends on when); and whether competitors' injury-prevention marketing is lawful —
[ADR 0009](../adr/0009-clean-room-posture.md) forbids deriving anything from it either way.

---

## 10. How to reproduce this

⚠️ **EUR-Lex's web front end will not serve these documents to a script** — HTTP 202 with an empty
body. The Publications Office Cellar will, and it needs `Accept-Language`.

```bash
# A — MDR as adopted
curl -sSL -H 'Accept: text/html, application/xhtml+xml' -H 'Accept-Language: eng' \
  -o mdr.xhtml 'http://publications.europa.eu/resource/celex/32017R0745'

# B — MDR consolidated at 2024-07-09
curl -sSL -H 'Accept: application/xhtml+xml' -H 'Accept-Language: eng' \
  -o mdr-consolidated.xhtml \
  'http://publications.europa.eu/resource/celex/02017R0745-20240709'

# C — MDCG 2019-11 Rev.1. The link is on the Commission's MDCG index page; take it
# from there rather than from a search engine, which returns the 2019 text (section 2).
curl -sSL -A 'Mozilla/5.0' -o mdcg-2019-11-rev1.pdf \
  'https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf'

# E — MHRA stand-alone software guidance v1.10f
curl -sSL -o mhra-standalone-software.pdf \
  'https://assets.publishing.service.gov.uk/media/64a7d22d7a4c230013bba33c/Medical_device_stand-alone_software_including_apps__including_IVDMDs_.pdf'

# F, G — UK MDR 2002 regulation 2, and MHRA's regulating-medical-devices page
curl -sSL -o uk-mdr-2002-reg2.html 'https://www.legislation.gov.uk/uksi/2002/618/regulation/2'
curl -sSL -o uk-regulating.html 'https://www.gov.uk/guidance/regulating-medical-devices-in-the-uk'

shasum -a 256 mdr.xhtml mdr-consolidated.xhtml mdcg-2019-11-rev1.pdf \
  mhra-standalone-software.pdf uk-mdr-2002-reg2.html uk-regulating.html
```

⚠️ **A digest that does not reproduce is not evidence of tampering.** `gov.uk` and the Commission
republish these files; the digests in §1 pin what was read on 2026-09-23 and nothing more. If one
moves, the quotations are what to re-check.
