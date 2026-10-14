# F01 independent oracle ledger

Ledger version `f01-v1`, seed `20261008`. Actual authorship: OpenAI Codex (GPT-6.1-sol), authored from the graph sketches and source-text generation rules before application/query implementation. Independent human reviewer: none recorded. Human sign-off: none. Participant review remains pending. The expected answers below are authored from the declared graph topology, never application answers.

Each edge's provenance is the immutable document revision plus anchor listed below. The generator writes an exact synthetic assertion for its endpoint IDs/type at that anchor, and recomputes the revision content digest. `CITES` points to a decision's cited source revision; the cited revision itself includes an anchored synthetic rationale excerpt, while the relationship provenance excerpt asserts the exact citation. Evaluators must inspect both exact paths and cited text, not accept a resolvable citation alone.

## Q01–Q20 exact path oracle

| ID | Expected directed path IDs | Required result |
|---|---|---|
| Q01 | `edge:0008`, `edge:0307`, `edge:0308`, `edge:0349`, `edge:0729` | `service:011 → service:010`; `person:010 OWNS service:011`, `person:009 OWNS service:010`; P011 uses S011 and is owned by person:051. |
| Q02 | `edge:0012`, `edge:0013`, `edge:0316`, `edge:0317`, `edge:0319` | Incoming path `service:024 → service:022 → service:021`; owners person:022, person:020, person:019 respectively. |
| Q03 | `edge:0019`, `edge:0020`, `edge:0021`, `edge:0325`, `edge:0326`, `edge:0327`, `edge:0328` | `service:033 → service:032 → service:031 → service:030`; three-hop terminal set, owners person:031/030/029/028. |
| Q04 | `edge:0001`, `edge:0002`, `edge:0003`, `edge:0004`, `edge:0005`, `edge:0006`, `edge:0007`, `edge:0299`, `edge:0300`, `edge:0301`, `edge:0302`, `edge:0303` | From service:001, retain routes service:005→service:002→service:001; service:005→service:003→service:001; service:005→service:003→service:002→service:001; service:004 reaches through service:003; service:006 is direct consumer. |
| Q05 | `edge:0001`, `edge:0002`, `edge:0003`, `edge:0004`, `edge:0005`, `edge:0006`, `edge:0007`, `edge:0299`, `edge:0300`, `edge:0301`, `edge:0302`, `edge:0303` | From service:001, direct consumers service:002/service:003/service:006; service:004/service:005 are also reachable; preserve each supported path and owner. |
| Q06 | `edge:0304`, `edge:0345`, `edge:0725` | P007 uses S007; service owner person:006, project owner person:047; no service consumer. |
| Q07 | `edge:0305`, `edge:0346`, `edge:0726` | P008 uses S008; direct service owner person:007 and project owner person:048. |
| Q08 | `edge:0306` | Direct owner person:008 for service:009 only. |
| Q09 | `edge:0008`, `edge:0307`, `edge:0308`, `edge:0348`, `edge:0349`, `edge:0728`, `edge:0729` | Service:011 impacts service:010; target/consumer owners person:009/person:010; P010 and P011 use S010/S011. |
| Q10 | `edge:0009`, `edge:0309`, `edge:0341`, `edge:0342`, `edge:0350`, `edge:0351`, `edge:0721`, `edge:0722`, `edge:0730`, `edge:0731` | Service:013 impacts service:012; P003, P004, and P013 use S013; P012 uses S012; each has its own owner. |
| Q11 | `edge:0310`, `edge:0311` | Exactly two direct owners of service:014: person:012 and person:013. |
| Q12 | `edge:0010`, `edge:0353`, `edge:0354`, `edge:0733`, `edge:0734` | Service:016 impacts service:015; P015/P016 use S015/S016 and are owned by persons 055/056; no OWNS edge into service:016. |
| Q13 | `edge:0312` | Canonical ID service:017 resolves owner person:015; similar label service:018 is not substituted. |
| Q14 | `edge:0011`, `edge:0313`, `edge:0314`, `edge:0356`, `edge:0357`, `edge:0736`, `edge:0737` | Service:019 impacts service:018; P018/P019 use S018/S019 and are owned by persons 058/059; disconnected service:020 excluded. |
| Q15 | `edge:0001`, `edge:0002`, `edge:0003`, `edge:0004`, `edge:0005`, `edge:0006`, `edge:0007`, `edge:0299`, `edge:0300`, `edge:0301`, `edge:0302`, `edge:0303`, `edge:0339`, `edge:0340`, `edge:0343`, `edge:0344`, `edge:0719`, `edge:0720`, `edge:0723`, `edge:0724` | P001/P002 share person:040; affected P005/P006 owners also returned. Preserve each project/use/impact path. |
| Q16 | `edge:0012`, `edge:0316`, `edge:0317` | Prerequisites from service:022 follow outgoing `service:022 → service:021`; include both direct service owners. |
| Q17 | `edge:0013`, `edge:0317`, `edge:0319` | Impact from service:022 follows incoming `service:024 → service:022`; distinct from Q16. |
| Q18 | `edge:0014`, `edge:0015`, `edge:0016`, `edge:0017`, `edge:0018`, `edge:0320`, `edge:0321`, `edge:0322`, `edge:0323`, `edge:0324` | Incoming impact from service:025 fully includes cycle services:026/027/028/029; path service:029→service:028→service:027→service:026→service:025, with cycle reported. |
| Q19 | `edge:0019`, `edge:0020`, `edge:0021`, `edge:0325`, `edge:0326`, `edge:0327`, `edge:0328` | Incoming traversal from service:030 reaches service:031/032/033 exactly at three hops; service:033 has no relevant incoming neighbor. |
| Q20 | `edge:0019`, `edge:0325`, `edge:0326` | Stable service:030 ID retains incoming service:031 and owner paths through its renamed display value. |

### Exact Q edge provenance

`edge ID → immutable provenance revision @ anchor`. Endpoint/type for each ID are defined by the corresponding Q row and the generator's stable ID order.

| IDs | Provenance revisions and anchors |
|---|---|
| 0001–0008 | 0001 `document:207 @ section-01/paragraph-01`; 0002 `document:147 @ section-02/paragraph-02`; 0003 `document:081 @ section-03/paragraph-03`; 0004 `document:157 @ section-04/paragraph-04`; 0005 `document:091 @ section-05/paragraph-05`; 0006 `document:209 @ section-06/paragraph-06`; 0007 `document:070 @ section-07/paragraph-07`; 0008 `document:120 @ section-08/paragraph-01`. |
| 0009–0019 | 0009 `document:055 @ section-09/paragraph-02`; 0010 `document:105 @ section-10/paragraph-03`; 0011 `document:217 @ section-11/paragraph-04`; 0012 `document:042 @ section-12/paragraph-05`; 0013 `document:146 @ section-01/paragraph-06`; 0014 `document:216 @ section-02/paragraph-07`; 0015 `document:107 @ section-03/paragraph-01`; 0016 `document:186 @ section-04/paragraph-02`; 0017 `document:011 @ section-05/paragraph-03`; 0018 `document:095 @ section-06/paragraph-04`; 0019 `document:121 @ section-07/paragraph-05`. |
| 0020–0021 | 0020 `document:208 @ section-08/paragraph-06`; 0021 `document:094 @ section-09/paragraph-07`. |
| 0299–0308 | 0299 `document:192 @ section-11/paragraph-05`; 0300 `document:210 @ section-12/paragraph-06`; 0302 `document:022 @ section-02/paragraph-01`; 0303 `document:122 @ section-03/paragraph-02`; 0304 `document:041 @ section-04/paragraph-03`; 0305 `document:095 @ section-05/paragraph-04`; 0306 `document:212 @ section-06/paragraph-05`; 0307 `document:041 @ section-07/paragraph-06`; 0308 `document:094 @ section-08/paragraph-07`. |
| 0309–0324 | 0309 `document:181 @ section-09/paragraph-01`; 0310 `document:140 @ section-10/paragraph-02`; 0311 `document:080 @ section-11/paragraph-03`; 0312 `document:009 @ section-12/paragraph-04`; 0313 `document:133 @ section-01/paragraph-05`; 0314 `document:205 @ section-02/paragraph-06`; 0316 `document:107 @ section-04/paragraph-01`; 0317 `document:090 @ section-05/paragraph-02`; 0319 `document:025 @ section-07/paragraph-04`; 0320 `document:211 @ section-08/paragraph-05`; 0321 `document:136 @ section-09/paragraph-06`; 0322 `document:152 @ section-10/paragraph-07`; 0323 `document:059 @ section-11/paragraph-01`; 0324 `document:129 @ section-12/paragraph-02`. |
| 0320–0328 | 0320 `document:211 @ section-08/paragraph-05`; 0321 `document:136 @ section-09/paragraph-06`; 0322 `document:152 @ section-10/paragraph-07`; 0325 `document:125 @ section-01/paragraph-03`; 0326 `document:068 @ section-02/paragraph-04`; 0327 `document:152 @ section-03/paragraph-05`; 0328 `document:069 @ section-04/paragraph-06`. |
| 0339–0351 | 0339 `document:162 @ section-03/paragraph-03`; 0340 `document:133 @ section-04/paragraph-04`; 0341 `document:044 @ section-05/paragraph-05`; 0342 `document:188 @ section-06/paragraph-06`; 0343 `document:025 @ section-07/paragraph-07`; 0344 `document:107 @ section-08/paragraph-01`; 0345 `document:187 @ section-09/paragraph-02`; 0346 `document:101 @ section-10/paragraph-03`; 0348 `document:030 @ section-12/paragraph-05`; 0351 `document:050 @ section-03/paragraph-01`. |
| 0719–0731 | 0719 `document:209 @ section-11/paragraph-05`; 0720 `document:138 @ section-12/paragraph-06`; 0721 `document:135 @ section-01/paragraph-07`; 0722 `document:104 @ section-02/paragraph-01`; 0723 `document:020 @ section-03/paragraph-02`; 0724 `document:009 @ section-04/paragraph-03`; 0725 `document:193 @ section-05/paragraph-04`; 0726 `document:007 @ section-06/paragraph-05`; 0728 `document:165 @ section-08/paragraph-07`; 0731 `document:118 @ section-11/paragraph-03`. |

The logical source ID is separately recorded on each fixture edge as `source_id`; values for the Q path edges are: `0001=074, 0002=049, 0003=027, 0004=053, 0005=031, 0006=075, 0007=024, 0008=040, 0009=019, 0010=035, 0011=079, 0012=014, 0013=049, 0014=078, 0015=036, 0018=032, 0019=041, 0020=074, 0021=032`; `0299=066, 0300=075, 0301=078, 0302=008, 0303=041, 0304=014, 0305=032, 0306=076, 0307=014, 0308=032, 0309=061, 0310=047, 0311=027, 0312=003, 0313=045, 0314=073, 0316=036, 0317=030, 0319=009, 0320=076, 0321=046, 0322=051, 0325=042, 0326=023, 0327=051, 0328=023`; `0339=054, 0340=045, 0341=015, 0342=064, 0343=009, 0344=036, 0345=064, 0346=034, 0348=010, 0351=017`; `0719=075, 0720=046, 0721=045, 0722=035, 0723=007, 0724=003, 0725=067, 0726=003, 0728=055, 0731=040`. Prefix each value with `source:`. This is distinct from immutable revision IDs in the preceding table.

## L01–L10 exact lineage oracle

For each row: links are directed newer decision → predecessor. All referenced decisions are accepted, share the row's subject/key, and remain in one linear chain. `CITES` target is the immutable rationale revision; the CITES relationship's provenance revision/anchor records the exact rationale text. Current/historical is derived from the complete validated chain, never from timestamps.

| ID | Prior / replacing; chain links | Prior / replacing CITES edges → cited revisions |
|---|---|---|
| L01 | decision:001 / decision:003; `edge:0041`, `edge:0044` | `edge:0040 → document:003 (source:001)`; `edge:0046 → document:009 (source:003)` |
| L02 | decision:004 / decision:006; `edge:0049`, `edge:0052` | `edge:0048 → document:009 (source:003)`; `edge:0054 → document:015 (source:005)` |
| L03 | decision:007 / decision:009; `edge:0057`, `edge:0060` | `edge:0056 → document:015 (source:005)`; `edge:0062 → document:021 (source:007)` |
| L04 | decision:010 / decision:012; `edge:0065`, `edge:0068` | `edge:0064 → document:021 (source:007)`; `edge:0070 → document:027 (source:009)` |
| L05 | decision:013 / decision:015; `edge:0073`, `edge:0076` | `edge:0072 → document:027 (source:009)`; `edge:0078 → document:033 (source:011)` |
| L06 | decision:016 / decision:018; `edge:0081`, `edge:0084` | `edge:0080 → document:033 (source:011)`; `edge:0086 → document:039 (source:013)` |
| L07 | decision:019 / decision:021; `edge:0089`, `edge:0092` | `edge:0088 → document:039 (source:013)`; `edge:0094 → document:045 (source:015)` |
| L08 | decision:022 / decision:024; `edge:0097`, `edge:0100` | `edge:0096 → document:045 (source:015)`; `edge:0102 → document:051 (source:017)` |
| L09 | decision:025 / decision:027; `edge:0105`, `edge:0108` | `edge:0104 → document:051 (source:017)`; `edge:0110 → document:057 (source:019)` |
| L10 | decision:028 / decision:030; `edge:0113`, `edge:0116` | `edge:0112 → document:057 (source:019)`; `edge:0118 → document:063 (source:021)` |

### Exact L edge provenance

Each listed revision and anchor is provenance for the relationship itself; the cited revision is the edge target listed above.

| Edge IDs | Provenance revisions and anchors |
|---|---|
| 0040–0049 | 0040 `document:080 @ section-04/paragraph-05`; 0041 `document:016 @ section-05/paragraph-06`; 0044 `document:016 @ section-08/paragraph-02`; 0046 `document:013 @ section-10/paragraph-04`; 0048 `document:164 @ section-12/paragraph-06`; 0049 `document:091 @ section-01/paragraph-07`. |
| 0052–0068 | 0052 `document:038 @ section-04/paragraph-03`; 0054 `document:144 @ section-06/paragraph-05`; 0056 `document:022 @ section-08/paragraph-07`; 0057 `document:200 @ section-09/paragraph-01`; 0060 `document:177 @ section-12/paragraph-04`; 0062 `document:134 @ section-02/paragraph-06`; 0064 `document:022 @ section-04/paragraph-01`; 0065 `document:012 @ section-05/paragraph-02`; 0068 `document:033 @ section-08/paragraph-05`. |
| 0070–0086 | 0070 `document:086 @ section-10/paragraph-07`; 0072 `document:054 @ section-12/paragraph-02`; 0073 `document:001 @ section-01/paragraph-03`; 0076 `document:065 @ section-04/paragraph-06`; 0078 `document:109 @ section-06/paragraph-01`; 0080 `document:172 @ section-08/paragraph-03`; 0081 `document:096 @ section-09/paragraph-04`; 0084 `document:037 @ section-12/paragraph-07`; 0086 `document:114 @ section-02/paragraph-02`. |
| 0088–0102 | 0088 `document:136 @ section-04/paragraph-04`; 0089 `document:063 @ section-05/paragraph-05`; 0092 `document:101 @ section-08/paragraph-01`; 0094 `document:007 @ section-10/paragraph-03`; 0096 `document:135 @ section-12/paragraph-05`; 0097 `document:094 @ section-01/paragraph-06`; 0100 `document:021 @ section-04/paragraph-02`; 0102 `document:133 @ section-06/paragraph-04`. |
| 0104–0118 | 0104 `document:205 @ section-08/paragraph-06`; 0105 `document:189 @ section-09/paragraph-07`; 0108 `document:134 @ section-12/paragraph-03`; 0110 `document:147 @ section-02/paragraph-05`; 0112 `document:042 @ section-04/paragraph-07`; 0113 `document:086 @ section-05/paragraph-01`; 0116 `document:023 @ section-08/paragraph-04`; 0118 `document:046 @ section-10/paragraph-06`. |


## Machine-checkable Q/L edge bindings

Each binding is the authored baseline edge identity and provenance expected by Q/L oracle paths.

<!-- ORACLE_EDGE_MANIFEST_BEGIN -->
```json
[
  {
    "id": "edge:0001",
    "type": "DEPENDS_ON",
    "from": "service:002",
    "to": "service:001",
    "revision": "document:207",
    "anchor": "section-01/paragraph-01",
    "source": "source:074",
    "validity": "current"
  },
  {
    "id": "edge:0002",
    "type": "DEPENDS_ON",
    "from": "service:003",
    "to": "service:002",
    "revision": "document:147",
    "anchor": "section-02/paragraph-02",
    "source": "source:049",
    "validity": "current"
  },
  {
    "id": "edge:0003",
    "type": "DEPENDS_ON",
    "from": "service:004",
    "to": "service:003",
    "revision": "document:081",
    "anchor": "section-03/paragraph-03",
    "source": "source:027",
    "validity": "current"
  },
  {
    "id": "edge:0004",
    "type": "DEPENDS_ON",
    "from": "service:005",
    "to": "service:002",
    "revision": "document:157",
    "anchor": "section-04/paragraph-04",
    "source": "source:053",
    "validity": "current"
  },
  {
    "id": "edge:0005",
    "type": "DEPENDS_ON",
    "from": "service:005",
    "to": "service:003",
    "revision": "document:091",
    "anchor": "section-05/paragraph-05",
    "source": "source:031",
    "validity": "current"
  },
  {
    "id": "edge:0006",
    "type": "DEPENDS_ON",
    "from": "service:003",
    "to": "service:001",
    "revision": "document:209",
    "anchor": "section-06/paragraph-06",
    "source": "source:075",
    "validity": "current"
  },
  {
    "id": "edge:0007",
    "type": "DEPENDS_ON",
    "from": "service:006",
    "to": "service:001",
    "revision": "document:070",
    "anchor": "section-07/paragraph-07",
    "source": "source:024",
    "validity": "current"
  },
  {
    "id": "edge:0008",
    "type": "DEPENDS_ON",
    "from": "service:011",
    "to": "service:010",
    "revision": "document:120",
    "anchor": "section-08/paragraph-01",
    "source": "source:040",
    "validity": "current"
  },
  {
    "id": "edge:0009",
    "type": "DEPENDS_ON",
    "from": "service:013",
    "to": "service:012",
    "revision": "document:055",
    "anchor": "section-09/paragraph-02",
    "source": "source:019",
    "validity": "current"
  },
  {
    "id": "edge:0010",
    "type": "DEPENDS_ON",
    "from": "service:016",
    "to": "service:015",
    "revision": "document:105",
    "anchor": "section-10/paragraph-03",
    "source": "source:035",
    "validity": "current"
  },
  {
    "id": "edge:0011",
    "type": "DEPENDS_ON",
    "from": "service:019",
    "to": "service:018",
    "revision": "document:217",
    "anchor": "section-11/paragraph-04",
    "source": "source:079",
    "validity": "current"
  },
  {
    "id": "edge:0012",
    "type": "DEPENDS_ON",
    "from": "service:022",
    "to": "service:021",
    "revision": "document:042",
    "anchor": "section-12/paragraph-05",
    "source": "source:014",
    "validity": "current"
  },
  {
    "id": "edge:0013",
    "type": "DEPENDS_ON",
    "from": "service:024",
    "to": "service:022",
    "revision": "document:146",
    "anchor": "section-01/paragraph-06",
    "source": "source:049",
    "validity": "current"
  },
  {
    "id": "edge:0014",
    "type": "DEPENDS_ON",
    "from": "service:026",
    "to": "service:025",
    "revision": "document:216",
    "anchor": "section-02/paragraph-07",
    "source": "source:078",
    "validity": "current"
  },
  {
    "id": "edge:0015",
    "type": "DEPENDS_ON",
    "from": "service:025",
    "to": "service:026",
    "revision": "document:107",
    "anchor": "section-03/paragraph-01",
    "source": "source:036",
    "validity": "current"
  },
  {
    "id": "edge:0016",
    "type": "DEPENDS_ON",
    "from": "service:029",
    "to": "service:028",
    "revision": "document:186",
    "anchor": "section-04/paragraph-02",
    "source": "source:063",
    "validity": "current"
  },
  {
    "id": "edge:0017",
    "type": "DEPENDS_ON",
    "from": "service:028",
    "to": "service:027",
    "revision": "document:011",
    "anchor": "section-05/paragraph-03",
    "source": "source:004",
    "validity": "current"
  },
  {
    "id": "edge:0018",
    "type": "DEPENDS_ON",
    "from": "service:027",
    "to": "service:026",
    "revision": "document:095",
    "anchor": "section-06/paragraph-04",
    "source": "source:032",
    "validity": "current"
  },
  {
    "id": "edge:0019",
    "type": "DEPENDS_ON",
    "from": "service:031",
    "to": "service:030",
    "revision": "document:121",
    "anchor": "section-07/paragraph-05",
    "source": "source:041",
    "validity": "current"
  },
  {
    "id": "edge:0020",
    "type": "DEPENDS_ON",
    "from": "service:032",
    "to": "service:031",
    "revision": "document:208",
    "anchor": "section-08/paragraph-06",
    "source": "source:074",
    "validity": "current"
  },
  {
    "id": "edge:0021",
    "type": "DEPENDS_ON",
    "from": "service:033",
    "to": "service:032",
    "revision": "document:094",
    "anchor": "section-09/paragraph-07",
    "source": "source:032",
    "validity": "current"
  },
  {
    "id": "edge:0040",
    "type": "CITES",
    "from": "decision:001",
    "to": "document:003",
    "revision": "document:080",
    "anchor": "section-04/paragraph-05",
    "source": "source:027",
    "validity": "current"
  },
  {
    "id": "edge:0041",
    "type": "SUPERSEDES",
    "from": "decision:002",
    "to": "decision:001",
    "revision": "document:016",
    "anchor": "section-05/paragraph-06",
    "source": "source:006",
    "validity": "current"
  },
  {
    "id": "edge:0044",
    "type": "SUPERSEDES",
    "from": "decision:003",
    "to": "decision:002",
    "revision": "document:016",
    "anchor": "section-08/paragraph-02",
    "source": "source:006",
    "validity": "current"
  },
  {
    "id": "edge:0046",
    "type": "CITES",
    "from": "decision:003",
    "to": "document:009",
    "revision": "document:013",
    "anchor": "section-10/paragraph-04",
    "source": "source:005",
    "validity": "current"
  },
  {
    "id": "edge:0048",
    "type": "CITES",
    "from": "decision:004",
    "to": "document:009",
    "revision": "document:164",
    "anchor": "section-12/paragraph-06",
    "source": "source:055",
    "validity": "current"
  },
  {
    "id": "edge:0049",
    "type": "SUPERSEDES",
    "from": "decision:005",
    "to": "decision:004",
    "revision": "document:091",
    "anchor": "section-01/paragraph-07",
    "source": "source:031",
    "validity": "current"
  },
  {
    "id": "edge:0052",
    "type": "SUPERSEDES",
    "from": "decision:006",
    "to": "decision:005",
    "revision": "document:038",
    "anchor": "section-04/paragraph-03",
    "source": "source:013",
    "validity": "current"
  },
  {
    "id": "edge:0054",
    "type": "CITES",
    "from": "decision:006",
    "to": "document:015",
    "revision": "document:144",
    "anchor": "section-06/paragraph-05",
    "source": "source:048",
    "validity": "current"
  },
  {
    "id": "edge:0056",
    "type": "CITES",
    "from": "decision:007",
    "to": "document:015",
    "revision": "document:022",
    "anchor": "section-08/paragraph-07",
    "source": "source:008",
    "validity": "current"
  },
  {
    "id": "edge:0057",
    "type": "SUPERSEDES",
    "from": "decision:008",
    "to": "decision:007",
    "revision": "document:200",
    "anchor": "section-09/paragraph-01",
    "source": "source:070",
    "validity": "current"
  },
  {
    "id": "edge:0060",
    "type": "SUPERSEDES",
    "from": "decision:009",
    "to": "decision:008",
    "revision": "document:177",
    "anchor": "section-12/paragraph-04",
    "source": "source:059",
    "validity": "current"
  },
  {
    "id": "edge:0062",
    "type": "CITES",
    "from": "decision:009",
    "to": "document:021",
    "revision": "document:134",
    "anchor": "section-02/paragraph-06",
    "source": "source:045",
    "validity": "current"
  },
  {
    "id": "edge:0064",
    "type": "CITES",
    "from": "decision:010",
    "to": "document:021",
    "revision": "document:022",
    "anchor": "section-04/paragraph-01",
    "source": "source:008",
    "validity": "current"
  },
  {
    "id": "edge:0065",
    "type": "SUPERSEDES",
    "from": "decision:011",
    "to": "decision:010",
    "revision": "document:012",
    "anchor": "section-05/paragraph-02",
    "source": "source:004",
    "validity": "current"
  },
  {
    "id": "edge:0068",
    "type": "SUPERSEDES",
    "from": "decision:012",
    "to": "decision:011",
    "revision": "document:033",
    "anchor": "section-08/paragraph-05",
    "source": "source:011",
    "validity": "current"
  },
  {
    "id": "edge:0070",
    "type": "CITES",
    "from": "decision:012",
    "to": "document:027",
    "revision": "document:086",
    "anchor": "section-10/paragraph-07",
    "source": "source:029",
    "validity": "current"
  },
  {
    "id": "edge:0072",
    "type": "CITES",
    "from": "decision:013",
    "to": "document:027",
    "revision": "document:054",
    "anchor": "section-12/paragraph-02",
    "source": "source:018",
    "validity": "current"
  },
  {
    "id": "edge:0073",
    "type": "SUPERSEDES",
    "from": "decision:014",
    "to": "decision:013",
    "revision": "document:001",
    "anchor": "section-01/paragraph-03",
    "source": "source:001",
    "validity": "current"
  },
  {
    "id": "edge:0076",
    "type": "SUPERSEDES",
    "from": "decision:015",
    "to": "decision:014",
    "revision": "document:065",
    "anchor": "section-04/paragraph-06",
    "source": "source:022",
    "validity": "current"
  },
  {
    "id": "edge:0078",
    "type": "CITES",
    "from": "decision:015",
    "to": "document:033",
    "revision": "document:109",
    "anchor": "section-06/paragraph-01",
    "source": "source:037",
    "validity": "current"
  },
  {
    "id": "edge:0080",
    "type": "CITES",
    "from": "decision:016",
    "to": "document:033",
    "revision": "document:172",
    "anchor": "section-08/paragraph-03",
    "source": "source:058",
    "validity": "current"
  },
  {
    "id": "edge:0081",
    "type": "SUPERSEDES",
    "from": "decision:017",
    "to": "decision:016",
    "revision": "document:096",
    "anchor": "section-09/paragraph-04",
    "source": "source:032",
    "validity": "current"
  },
  {
    "id": "edge:0084",
    "type": "SUPERSEDES",
    "from": "decision:018",
    "to": "decision:017",
    "revision": "document:037",
    "anchor": "section-12/paragraph-07",
    "source": "source:013",
    "validity": "current"
  },
  {
    "id": "edge:0086",
    "type": "CITES",
    "from": "decision:018",
    "to": "document:039",
    "revision": "document:114",
    "anchor": "section-02/paragraph-02",
    "source": "source:038",
    "validity": "current"
  },
  {
    "id": "edge:0088",
    "type": "CITES",
    "from": "decision:019",
    "to": "document:039",
    "revision": "document:136",
    "anchor": "section-04/paragraph-04",
    "source": "source:046",
    "validity": "current"
  },
  {
    "id": "edge:0089",
    "type": "SUPERSEDES",
    "from": "decision:020",
    "to": "decision:019",
    "revision": "document:063",
    "anchor": "section-05/paragraph-05",
    "source": "source:021",
    "validity": "current"
  },
  {
    "id": "edge:0092",
    "type": "SUPERSEDES",
    "from": "decision:021",
    "to": "decision:020",
    "revision": "document:101",
    "anchor": "section-08/paragraph-01",
    "source": "source:034",
    "validity": "current"
  },
  {
    "id": "edge:0094",
    "type": "CITES",
    "from": "decision:021",
    "to": "document:045",
    "revision": "document:007",
    "anchor": "section-10/paragraph-03",
    "source": "source:003",
    "validity": "current"
  },
  {
    "id": "edge:0096",
    "type": "CITES",
    "from": "decision:022",
    "to": "document:045",
    "revision": "document:135",
    "anchor": "section-12/paragraph-05",
    "source": "source:045",
    "validity": "current"
  },
  {
    "id": "edge:0097",
    "type": "SUPERSEDES",
    "from": "decision:023",
    "to": "decision:022",
    "revision": "document:094",
    "anchor": "section-01/paragraph-06",
    "source": "source:032",
    "validity": "current"
  },
  {
    "id": "edge:0100",
    "type": "SUPERSEDES",
    "from": "decision:024",
    "to": "decision:023",
    "revision": "document:021",
    "anchor": "section-04/paragraph-02",
    "source": "source:007",
    "validity": "current"
  },
  {
    "id": "edge:0102",
    "type": "CITES",
    "from": "decision:024",
    "to": "document:051",
    "revision": "document:133",
    "anchor": "section-06/paragraph-04",
    "source": "source:045",
    "validity": "current"
  },
  {
    "id": "edge:0104",
    "type": "CITES",
    "from": "decision:025",
    "to": "document:051",
    "revision": "document:205",
    "anchor": "section-08/paragraph-06",
    "source": "source:073",
    "validity": "current"
  },
  {
    "id": "edge:0105",
    "type": "SUPERSEDES",
    "from": "decision:026",
    "to": "decision:025",
    "revision": "document:189",
    "anchor": "section-09/paragraph-07",
    "source": "source:065",
    "validity": "current"
  },
  {
    "id": "edge:0108",
    "type": "SUPERSEDES",
    "from": "decision:027",
    "to": "decision:026",
    "revision": "document:134",
    "anchor": "section-12/paragraph-03",
    "source": "source:045",
    "validity": "current"
  },
  {
    "id": "edge:0110",
    "type": "CITES",
    "from": "decision:027",
    "to": "document:057",
    "revision": "document:147",
    "anchor": "section-02/paragraph-05",
    "source": "source:049",
    "validity": "current"
  },
  {
    "id": "edge:0112",
    "type": "CITES",
    "from": "decision:028",
    "to": "document:057",
    "revision": "document:042",
    "anchor": "section-04/paragraph-07",
    "source": "source:014",
    "validity": "current"
  },
  {
    "id": "edge:0113",
    "type": "SUPERSEDES",
    "from": "decision:029",
    "to": "decision:028",
    "revision": "document:086",
    "anchor": "section-05/paragraph-01",
    "source": "source:029",
    "validity": "current"
  },
  {
    "id": "edge:0116",
    "type": "SUPERSEDES",
    "from": "decision:030",
    "to": "decision:029",
    "revision": "document:023",
    "anchor": "section-08/paragraph-04",
    "source": "source:008",
    "validity": "current"
  },
  {
    "id": "edge:0118",
    "type": "CITES",
    "from": "decision:030",
    "to": "document:063",
    "revision": "document:046",
    "anchor": "section-10/paragraph-06",
    "source": "source:016",
    "validity": "current"
  },
  {
    "id": "edge:0299",
    "type": "OWNS",
    "from": "person:001",
    "to": "service:002",
    "revision": "document:192",
    "anchor": "section-11/paragraph-05",
    "source": "source:066",
    "validity": "current"
  },
  {
    "id": "edge:0300",
    "type": "OWNS",
    "from": "person:002",
    "to": "service:003",
    "revision": "document:210",
    "anchor": "section-12/paragraph-06",
    "source": "source:075",
    "validity": "current"
  },
  {
    "id": "edge:0301",
    "type": "OWNS",
    "from": "person:003",
    "to": "service:004",
    "revision": "document:215",
    "anchor": "section-01/paragraph-07",
    "source": "source:078",
    "validity": "current"
  },
  {
    "id": "edge:0302",
    "type": "OWNS",
    "from": "person:004",
    "to": "service:005",
    "revision": "document:022",
    "anchor": "section-02/paragraph-01",
    "source": "source:008",
    "validity": "current"
  },
  {
    "id": "edge:0303",
    "type": "OWNS",
    "from": "person:005",
    "to": "service:006",
    "revision": "document:122",
    "anchor": "section-03/paragraph-02",
    "source": "source:041",
    "validity": "current"
  },
  {
    "id": "edge:0304",
    "type": "OWNS",
    "from": "person:006",
    "to": "service:007",
    "revision": "document:041",
    "anchor": "section-04/paragraph-03",
    "source": "source:014",
    "validity": "current"
  },
  {
    "id": "edge:0305",
    "type": "OWNS",
    "from": "person:007",
    "to": "service:008",
    "revision": "document:095",
    "anchor": "section-05/paragraph-04",
    "source": "source:032",
    "validity": "current"
  },
  {
    "id": "edge:0306",
    "type": "OWNS",
    "from": "person:008",
    "to": "service:009",
    "revision": "document:212",
    "anchor": "section-06/paragraph-05",
    "source": "source:076",
    "validity": "current"
  },
  {
    "id": "edge:0307",
    "type": "OWNS",
    "from": "person:009",
    "to": "service:010",
    "revision": "document:041",
    "anchor": "section-07/paragraph-06",
    "source": "source:014",
    "validity": "current"
  },
  {
    "id": "edge:0308",
    "type": "OWNS",
    "from": "person:010",
    "to": "service:011",
    "revision": "document:094",
    "anchor": "section-08/paragraph-07",
    "source": "source:032",
    "validity": "current"
  },
  {
    "id": "edge:0309",
    "type": "OWNS",
    "from": "person:011",
    "to": "service:013",
    "revision": "document:181",
    "anchor": "section-09/paragraph-01",
    "source": "source:061",
    "validity": "current"
  },
  {
    "id": "edge:0310",
    "type": "OWNS",
    "from": "person:012",
    "to": "service:014",
    "revision": "document:140",
    "anchor": "section-10/paragraph-02",
    "source": "source:047",
    "validity": "current"
  },
  {
    "id": "edge:0311",
    "type": "OWNS",
    "from": "person:013",
    "to": "service:014",
    "revision": "document:080",
    "anchor": "section-11/paragraph-03",
    "source": "source:027",
    "validity": "current"
  },
  {
    "id": "edge:0312",
    "type": "OWNS",
    "from": "person:015",
    "to": "service:017",
    "revision": "document:009",
    "anchor": "section-12/paragraph-04",
    "source": "source:003",
    "validity": "current"
  },
  {
    "id": "edge:0313",
    "type": "OWNS",
    "from": "person:016",
    "to": "service:018",
    "revision": "document:133",
    "anchor": "section-01/paragraph-05",
    "source": "source:045",
    "validity": "current"
  },
  {
    "id": "edge:0314",
    "type": "OWNS",
    "from": "person:017",
    "to": "service:019",
    "revision": "document:205",
    "anchor": "section-02/paragraph-06",
    "source": "source:073",
    "validity": "current"
  },
  {
    "id": "edge:0316",
    "type": "OWNS",
    "from": "person:019",
    "to": "service:021",
    "revision": "document:107",
    "anchor": "section-04/paragraph-01",
    "source": "source:036",
    "validity": "current"
  },
  {
    "id": "edge:0317",
    "type": "OWNS",
    "from": "person:020",
    "to": "service:022",
    "revision": "document:090",
    "anchor": "section-05/paragraph-02",
    "source": "source:030",
    "validity": "current"
  },
  {
    "id": "edge:0319",
    "type": "OWNS",
    "from": "person:022",
    "to": "service:024",
    "revision": "document:025",
    "anchor": "section-07/paragraph-04",
    "source": "source:009",
    "validity": "current"
  },
  {
    "id": "edge:0320",
    "type": "OWNS",
    "from": "person:023",
    "to": "service:025",
    "revision": "document:211",
    "anchor": "section-08/paragraph-05",
    "source": "source:076",
    "validity": "current"
  },
  {
    "id": "edge:0321",
    "type": "OWNS",
    "from": "person:024",
    "to": "service:026",
    "revision": "document:136",
    "anchor": "section-09/paragraph-06",
    "source": "source:046",
    "validity": "current"
  },
  {
    "id": "edge:0322",
    "type": "OWNS",
    "from": "person:025",
    "to": "service:027",
    "revision": "document:152",
    "anchor": "section-10/paragraph-07",
    "source": "source:051",
    "validity": "current"
  },
  {
    "id": "edge:0323",
    "type": "OWNS",
    "from": "person:026",
    "to": "service:028",
    "revision": "document:059",
    "anchor": "section-11/paragraph-01",
    "source": "source:020",
    "validity": "current"
  },
  {
    "id": "edge:0324",
    "type": "OWNS",
    "from": "person:027",
    "to": "service:029",
    "revision": "document:129",
    "anchor": "section-12/paragraph-02",
    "source": "source:043",
    "validity": "current"
  },
  {
    "id": "edge:0325",
    "type": "OWNS",
    "from": "person:028",
    "to": "service:030",
    "revision": "document:125",
    "anchor": "section-01/paragraph-03",
    "source": "source:042",
    "validity": "current"
  },
  {
    "id": "edge:0326",
    "type": "OWNS",
    "from": "person:029",
    "to": "service:031",
    "revision": "document:068",
    "anchor": "section-02/paragraph-04",
    "source": "source:023",
    "validity": "current"
  },
  {
    "id": "edge:0327",
    "type": "OWNS",
    "from": "person:030",
    "to": "service:032",
    "revision": "document:152",
    "anchor": "section-03/paragraph-05",
    "source": "source:051",
    "validity": "current"
  },
  {
    "id": "edge:0328",
    "type": "OWNS",
    "from": "person:031",
    "to": "service:033",
    "revision": "document:069",
    "anchor": "section-04/paragraph-06",
    "source": "source:023",
    "validity": "current"
  },
  {
    "id": "edge:0339",
    "type": "OWNS",
    "from": "person:040",
    "to": "project:001",
    "revision": "document:162",
    "anchor": "section-03/paragraph-03",
    "source": "source:054",
    "validity": "current"
  },
  {
    "id": "edge:0340",
    "type": "OWNS",
    "from": "person:040",
    "to": "project:002",
    "revision": "document:133",
    "anchor": "section-04/paragraph-04",
    "source": "source:045",
    "validity": "current"
  },
  {
    "id": "edge:0341",
    "type": "OWNS",
    "from": "person:043",
    "to": "project:003",
    "revision": "document:044",
    "anchor": "section-05/paragraph-05",
    "source": "source:015",
    "validity": "current"
  },
  {
    "id": "edge:0342",
    "type": "OWNS",
    "from": "person:044",
    "to": "project:004",
    "revision": "document:188",
    "anchor": "section-06/paragraph-06",
    "source": "source:064",
    "validity": "current"
  },
  {
    "id": "edge:0343",
    "type": "OWNS",
    "from": "person:045",
    "to": "project:005",
    "revision": "document:025",
    "anchor": "section-07/paragraph-07",
    "source": "source:009",
    "validity": "current"
  },
  {
    "id": "edge:0344",
    "type": "OWNS",
    "from": "person:046",
    "to": "project:006",
    "revision": "document:107",
    "anchor": "section-08/paragraph-01",
    "source": "source:036",
    "validity": "current"
  },
  {
    "id": "edge:0345",
    "type": "OWNS",
    "from": "person:047",
    "to": "project:007",
    "revision": "document:187",
    "anchor": "section-09/paragraph-02",
    "source": "source:064",
    "validity": "current"
  },
  {
    "id": "edge:0346",
    "type": "OWNS",
    "from": "person:048",
    "to": "project:008",
    "revision": "document:101",
    "anchor": "section-10/paragraph-03",
    "source": "source:034",
    "validity": "current"
  },
  {
    "id": "edge:0348",
    "type": "OWNS",
    "from": "person:050",
    "to": "project:010",
    "revision": "document:030",
    "anchor": "section-12/paragraph-05",
    "source": "source:010",
    "validity": "current"
  },
  {
    "id": "edge:0349",
    "type": "OWNS",
    "from": "person:051",
    "to": "project:011",
    "revision": "document:129",
    "anchor": "section-01/paragraph-06",
    "source": "source:043",
    "validity": "current"
  },
  {
    "id": "edge:0350",
    "type": "OWNS",
    "from": "person:052",
    "to": "project:012",
    "revision": "document:088",
    "anchor": "section-02/paragraph-07",
    "source": "source:030",
    "validity": "current"
  },
  {
    "id": "edge:0351",
    "type": "OWNS",
    "from": "person:053",
    "to": "project:013",
    "revision": "document:050",
    "anchor": "section-03/paragraph-01",
    "source": "source:017",
    "validity": "current"
  },
  {
    "id": "edge:0353",
    "type": "OWNS",
    "from": "person:055",
    "to": "project:015",
    "revision": "document:209",
    "anchor": "section-05/paragraph-03",
    "source": "source:075",
    "validity": "current"
  },
  {
    "id": "edge:0354",
    "type": "OWNS",
    "from": "person:056",
    "to": "project:016",
    "revision": "document:128",
    "anchor": "section-06/paragraph-04",
    "source": "source:043",
    "validity": "current"
  },
  {
    "id": "edge:0356",
    "type": "OWNS",
    "from": "person:058",
    "to": "project:018",
    "revision": "document:011",
    "anchor": "section-08/paragraph-06",
    "source": "source:004",
    "validity": "current"
  },
  {
    "id": "edge:0357",
    "type": "OWNS",
    "from": "person:059",
    "to": "project:019",
    "revision": "document:112",
    "anchor": "section-09/paragraph-07",
    "source": "source:038",
    "validity": "current"
  },
  {
    "id": "edge:0719",
    "type": "USES",
    "from": "project:001",
    "to": "service:001",
    "revision": "document:209",
    "anchor": "section-11/paragraph-05",
    "source": "source:075",
    "validity": "current"
  },
  {
    "id": "edge:0720",
    "type": "USES",
    "from": "project:002",
    "to": "service:002",
    "revision": "document:138",
    "anchor": "section-12/paragraph-06",
    "source": "source:046",
    "validity": "current"
  },
  {
    "id": "edge:0721",
    "type": "USES",
    "from": "project:003",
    "to": "service:013",
    "revision": "document:135",
    "anchor": "section-01/paragraph-07",
    "source": "source:045",
    "validity": "current"
  },
  {
    "id": "edge:0722",
    "type": "USES",
    "from": "project:004",
    "to": "service:013",
    "revision": "document:104",
    "anchor": "section-02/paragraph-01",
    "source": "source:035",
    "validity": "current"
  },
  {
    "id": "edge:0723",
    "type": "USES",
    "from": "project:005",
    "to": "service:005",
    "revision": "document:020",
    "anchor": "section-03/paragraph-02",
    "source": "source:007",
    "validity": "current"
  },
  {
    "id": "edge:0724",
    "type": "USES",
    "from": "project:006",
    "to": "service:006",
    "revision": "document:009",
    "anchor": "section-04/paragraph-03",
    "source": "source:003",
    "validity": "current"
  },
  {
    "id": "edge:0725",
    "type": "USES",
    "from": "project:007",
    "to": "service:007",
    "revision": "document:193",
    "anchor": "section-05/paragraph-04",
    "source": "source:067",
    "validity": "current"
  },
  {
    "id": "edge:0726",
    "type": "USES",
    "from": "project:008",
    "to": "service:008",
    "revision": "document:007",
    "anchor": "section-06/paragraph-05",
    "source": "source:003",
    "validity": "current"
  },
  {
    "id": "edge:0728",
    "type": "USES",
    "from": "project:010",
    "to": "service:010",
    "revision": "document:165",
    "anchor": "section-08/paragraph-07",
    "source": "source:055",
    "validity": "current"
  },
  {
    "id": "edge:0729",
    "type": "USES",
    "from": "project:011",
    "to": "service:011",
    "revision": "document:132",
    "anchor": "section-09/paragraph-01",
    "source": "source:044",
    "validity": "current"
  },
  {
    "id": "edge:0730",
    "type": "USES",
    "from": "project:012",
    "to": "service:012",
    "revision": "document:144",
    "anchor": "section-10/paragraph-02",
    "source": "source:048",
    "validity": "current"
  },
  {
    "id": "edge:0731",
    "type": "USES",
    "from": "project:013",
    "to": "service:013",
    "revision": "document:118",
    "anchor": "section-11/paragraph-03",
    "source": "source:040",
    "validity": "current"
  },
  {
    "id": "edge:0733",
    "type": "USES",
    "from": "project:015",
    "to": "service:015",
    "revision": "document:030",
    "anchor": "section-01/paragraph-05",
    "source": "source:010",
    "validity": "current"
  },
  {
    "id": "edge:0734",
    "type": "USES",
    "from": "project:016",
    "to": "service:016",
    "revision": "document:002",
    "anchor": "section-02/paragraph-06",
    "source": "source:001",
    "validity": "current"
  },
  {
    "id": "edge:0736",
    "type": "USES",
    "from": "project:018",
    "to": "service:018",
    "revision": "document:157",
    "anchor": "section-04/paragraph-01",
    "source": "source:053",
    "validity": "current"
  },
  {
    "id": "edge:0737",
    "type": "USES",
    "from": "project:019",
    "to": "service:019",
    "revision": "document:134",
    "anchor": "section-05/paragraph-02",
    "source": "source:045",
    "validity": "current"
  }
]
```
<!-- ORACLE_EDGE_MANIFEST_END -->
