# Wucheng 80-Chapter Novel Execution and Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Have the primary Codex agent personally write, revise, import, review, commit, and export an original 80-chapter Chinese commercial novel while using AINovel Studio as the system under test.

**Architecture:** Tracked authoring source and audit ledgers live under one stable run directory. Runtime Submissions, Versions, Reviews, Chapters, Canon, Summaries, and Exports live in a new AINovel Studio project. The primary agent is the sole prose author; subagents may report problems but may not draft replacement prose. Each four-chapter window is a hard checkpoint, and each sixteen-chapter volume is a recovery/audit checkpoint.

**Tech Stack:** Markdown/JSON/CSV source artifacts, AINovel Studio Author Mode, SQLite/project files, Reviewer and Artifact LLM roles, Playwright browser verification, SHA-256 checksums.

**Prerequisite:** Complete every task and the final gate in `docs/superpowers/plans/2026-07-11-author-mode-review-integrity-plan.md` before Task 1 below.

---

## Stable Run Paths

Create all tracked source/evidence under:

```text
docs/superpowers/runs/2026-07-11-wucheng-80/
  run-manifest.json
  story-bible.md
  chapter-map.csv
  chapters/chapter_001.md ... chapters/chapter_080.md
  ledgers/chapter-progress.csv
  ledgers/review-gold.jsonl
  ledgers/runtime-events.jsonl
  ledgers/call-counts.csv
  audits/window-001-004.md ... audits/window-077-080.md
  audits/volume-01.md ... audits/volume-05.md
  recovery/current-state.json
  reports/final-quality-report.md
  reports/platform-findings.md
  exports/雾城失物招领处.md
  exports/雾城失物招领处.txt
  checksums.sha256
```

Store browser artifacts under:

```text
artifacts/author-mode-80/wucheng-80/
  browser/
  traces/
  screenshots/
  downloads/
  final-audit.json
```

The runtime project ID is created through the real UI in Task 2 and then written atomically to `run-manifest.json`; it is never guessed or hard-coded in advance.

---

## Fixed Novel Contract

- **Title:** 《雾城失物招领处》
- **Genre:** 都市悬疑、民俗异闻、群像成长
- **Length:** 5 volumes × 16 chapters = 80 chapters
- **Chapter gate:** 2200–3200 non-whitespace Chinese正文 characters
- **Total gate:** at least 176000 non-whitespace Chinese正文 characters
- **POV:** third-person limited, primarily 林砚
- **Writer rule:** Reviewer/Artifact roles may call DeepSeek; Writer calls must remain exactly zero
- **Ending rule:** close the sister, Archive Bureau, memory-cost, 04:17, red umbrella, bus, ferry, and public-record promises without a forced sequel hook

### World Rules

1. An anomalous object reveals its owner's final sixty seconds only once.
2. Every reading erodes one private memory chosen by the phenomenon, not by 林砚.
3. An erased person remains briefly present in objects carrying a real emotional bond.
4. At 04:17, public records in 雾港 automatically correct themselves.
5. Remembering a name is insufficient; restoration requires independently verifiable public evidence.
6. The dead cannot be resurrected. 林见夏 is missing/alive in the erased layer, not dead.
7. Rules appear through consequences before explanation.

### Principal Cast

- **林砚:** night-shift lost-property clerk; moves from using people as evidence to taking responsibility for them.
- **林见夏:** his missing sister; actively protects erased residents and later returns alive with a cost.
- **苏栖:** night-radio producer; creates public evidence and resists sacrificing strangers for one family.
- **陈渡:** archive restorer; betrays the group to recover his erased family, then bears the cost of undoing it.
- **周野:** midnight-bus driver; trades routes for completed promises and ultimately loses his route/existence.
- **顾衡:** Archive Bureau director; preserves city stability by deleting lives, with comprehensible motives but unacceptable methods.

---

## Authoritative 80-Chapter Map

| Ch. | Title | Observable change | End hook / debt |
|---:|---|---|---|
| 1 | 红伞 | A seawater-dripping red umbrella arrives at the station and speaks with 林见夏's voice at 04:17. | The claim ticket is dated seven years in the future-facing archive format. |
| 2 | 最后六十秒 | 林砚 reads the umbrella, sees a woman fleeing Platform 9, and loses his memory of his mother's signature soup. | The remembered woman says “三号柜”. |
| 3 | 不存在的失主 | The ticket, owner, and platform do not exist in any digital record; 苏栖 contacts him over a call with no caller ID. | Her analog recorder preserves a name that the call log deletes. |
| 4 | 广播里的空白 | A live caller is erased at 04:17 while the tape retains a physical click and partial address. | The click pattern matches the station locker alarm. |
| 5 | 三号寄存柜 | Locker 3 contains a child's rain boot, an old ferry token, and a key that belongs to no station lock. | Wet footprints leave the closed locker after they turn away. |
| 6 | 被改写的监控 | 陈渡 recovers a paper maintenance sheet proving the camera footage rewrote itself. | The sheet lists 林见夏 as the technician on duty. |
| 7 | 雨水不能进站 | Letting the umbrella dry erases the child's trace; keeping it wet restores one sentence. | The station sprinklers activate by themselves at 04:17. |
| 8 | 借名 | A radio broadcast gives the erased child a temporary public identity and lets her mother remember her. | The borrowed name expires after sunrise. |
| 9 | 旧票背面 | Heat reveals Route 17 and a handwritten promise on the ferry token. | The last bus arrives although the route was abolished. |
| 10 | 周野的车 | 周野 accepts them only after they promise to deliver a dead passenger's letter. | The bus mirror shows thirteen passengers but only twelve seats. |
| 11 | 第十三位乘客 | The thirteenth shadow copies 林见夏's posture and points to an erased stop. | It leaves a wet handprint on 林砚's shoulder. |
| 12 | 一封送不到的信 | Delivering the letter restores one passenger to a family record and proves public evidence can resist correction. | The recipient remembers a red umbrella at the ferry terminal. |
| 13 | 红伞的主人 | A retired teacher admits she gave 林见夏 the umbrella, then refuses to sacrifice her living students to restore her. | Archive Bureau agents arrive with a destruction order. |
| 14 | 雾里站台 | The erased Platform 9 appears; the team steals one analog dispatch card from the agents. | The card schedules a “correction” for 林砚 himself. |
| 15 | 被删掉的一天 | 林砚 loses an entire day; 苏栖's handwritten log lets him reconstruct his own actions. | He discovers he voluntarily entered the Bureau during the missing hours. |
| 16 | 雨停之前 | The red-umbrella woman regains a durable family record; 林砚 loses his memory of his mother's face. | 林见夏's voice says, “别先救我，先救他们。” |
| 17 | 夜班名单 | Seventeen ownerless objects arrive in numerical order. | Every owner field is blank except “乘客”. |
| 18 | 空座来电 | 苏栖 receives calls from passengers on abolished Route 17. | One caller describes today's living commuter before he boards. |
| 19 | 车票不找零 | 周野 explains that each ride costs a memory and issues a ticket that cannot be refunded. | 林砚 forgets the address of his childhood home. |
| 20 | 七年前的乘客 | The passenger ledger lists 林见夏 after the official date of her disappearance. | A second entry records her getting off in the erased district. |
| 21 | 纸上的第二层字 | 陈渡 reveals palimpsest text beneath the corrected ledger. | His erased wife and daughter appear in the lower layer. |
| 22 | 一个活人的遗物 | An object belongs to a commuter who is still alive but already being forgotten. | His colleagues stop seeing him during the investigation. |
| 23 | 提前四分钟 | The correction occurs at 04:13, proving the system is destabilizing. | The next correction countdown begins immediately. |
| 24 | 直播事故 | 苏栖 keeps the commuter public through a live broadcast but exposes the team's method. | The Bureau shuts down the station transmitter. |
| 25 | 错站 | Route 17 enters a deleted neighborhood where answering one's name transfers identity. | 陈渡 answers to his daughter's name. |
| 26 | 无名照相馆 | Photographic plates preserve erased residents until the developer forgets them. | One plate shows 顾衡 at the ferry disaster. |
| 27 | 玻璃底片 | The team develops the plate and finds the Bureau seal on the ferry bulkhead. | 陈渡 secretly pockets a second plate. |
| 28 | 陈渡的条件 | 陈渡 demands that his family be included in any restoration plan and withholds the plate. | The plate contains coordinates for the drowned archive. |
| 29 | 城市不承认的路 | Paper maps and roads diverge; 周野 spends route knowledge to guide them. | One road ends at a wall that carries bus tire marks. |
| 30 | 乘客下车 | The living commuter is restored, but 周野 permanently loses one erased route. | The bus destination changes to “渡轮旧址”. |
| 31 | 十七件遗物 | All seventeen objects map to witnesses of the ferry correction. | The witness count should be eighteen. |
| 32 | 名单少了一个 | The blank eighteenth entry resolves into 林砚's own name. | His childhood memory includes a ferry ride he never knew he took. |
| 33 | 沉城入口 | Low tide exposes a service tunnel into the erased city layer. | The tunnel gate recognizes 林砚's forgotten childhood ticket. |
| 34 | 没有门牌的街 | The team navigates by object memories because street numbers correct themselves. | A house key opens three different homes. |
| 35 | 归档员 | Bureau field archivists try to classify the team as records rather than people. | 顾衡 offers safe passage if 林砚 surrenders the red umbrella. |
| 36 | 记忆保全计划 | They uncover the failed municipal project that created the 04:17 correction. | The original project operator is 林见夏. |
| 37 | 见夏留下的录音 | A tape shows 林见夏 voluntarily maintaining erased residents. | Her message warns that restoring her first will delete 127 others. |
| 38 | 陈渡的谎 | The hidden plate proves 陈渡's family were experiment subjects, not accident victims. | He has already sent their coordinates to 顾衡. |
| 39 | 只能带走一件 | A collapse forces the group to choose residents' names over the master archive device. | 陈渡 saves the device instead. |
| 40 | 空白母带 | A blank radio master can duplicate public memory but corrupt private memory. | 苏栖 volunteers her personal archive as the first test. |
| 41 | 一百二十七个名字 | The team reconstructs the protected residents' list. | The final name is fading faster than the others: 林见夏. |
| 42 | 旧医院停电夜 | An old hospital case reveals the first correction trial and its human cost. | 顾衡 was the doctor who stopped a wider collapse. |
| 43 | 忘了自己的生日 | Reading a hospital bracelet costs 林砚 his birthday and destabilizes his self-record. | His ID now shows a different birth date. |
| 44 | 苏栖停播 | The station closes her program; she builds a pirate analog transmitter. | The first illegal broadcast receives 127 simultaneous replies. |
| 45 | 周野的旧站牌 | 周野 admits he drove ferry survivors away and has carried their unkept promises since. | His own name is absent from every transport record. |
| 46 | 档案局封门 | 顾衡 seals the drowned archive and offers 林见夏 in exchange for silence. | The door opens from inside before 林砚 answers. |
| 47 | 姐姐在门后 | 林砚 meets 林见夏 across the erased-layer boundary; touch would collapse both records. | She asks him to read the umbrella one final time only at the end. |
| 48 | 她不记得我 | 林见夏 has sacrificed her memory of her brother to hold 127 identities. | She remembers his lost-property tag system but not his name. |
| 49 | 退潮预警 | Corrections begin occurring in daylight. | The next predicted disappearance is a current station colleague. |
| 50 | 第一个在白天消失的人 | The colleague is erased during lunch while physical belongings remain. | His desk label changes before anyone notices. |
| 51 | 家门换了锁 | 林砚's home and records remove him; only tracked run notes prove his identity. | The red umbrella still recognizes him. |
| 52 | 苏栖记住了两次 | Two independent broadcasts anchor 林砚, costing 苏栖 her only recording of her mother's voice. | The correction begins targeting the transmitter. |
| 53 | 陈渡回家 | 陈渡 enters a temporary home where his wife and daughter live without him. | 顾衡 offers three restoration slots. |
| 54 | 一家人的名额 | The slots require deleting three existing people; 陈渡 conceals the condition. | He selects names from the 127-person list. |
| 55 | 假名单 | The team creates decoy public records to split the correction process. | One decoy develops real memories. |
| 56 | 全城停电 | A blackout shifts correction authority from digital to paper records. | The Bureau begins burning physical archives. |
| 57 | 纸会说谎 | 陈渡 alters the ledger; 林砚 proves paper can be corrupted by motive as well as magic. | Three hundred names vanish from the master list. |
| 58 | 广播塔下 | The team defends the transmitter while residents repeat erased names. | Route 17 arrives at the sealed tower. |
| 59 | 周野最后一班车 | 周野 spends his remaining route/existence to carry the master list through the correction zone. | The bus arrives without a driver. |
| 60 | 谁来记住司机 | The group creates a public memorial record for 周野, but cannot restore him alive. | His old ticket machine prints one final route. |
| 61 | 姐姐的选择 | 林见夏 refuses the three-slot exchange and chooses the 127 residents. | 顾衡 starts the final correction manually. |
| 62 | 陈渡改了哪一行 | 陈渡's betrayal is exposed; restoring his family has erased three hundred strangers. | His daughter rejects the stolen restoration. |
| 63 | 三百件遗物 | Three hundred objects flood the station, each carrying a different last sixty seconds. | 林砚 cannot read them all without losing himself. |
| 64 | 退潮名单 | 林砚 chooses the three hundred strangers before his sister, and the team builds a distributed evidence plan. | 林见夏's name almost disappears from the list. |
| 65 | 把名字说给所有人听 | The pirate network distributes names across households and neighborhoods. | The Bureau begins deleting witnesses rather than records. |
| 66 | 城市的备份 | Tickets, radio tapes, school ledgers, photos, and personal objects become independent backups. | One backup points to 顾衡's sealed original archive. |
| 67 | 顾衡的原始档案 | The team obtains the uncorrected project log and learns 顾衡's true containment motive. | The log says the ferry was deliberately sacrificed. |
| 68 | 七年前真正的事故 | The ferry disaster is reconstructed as a choice that stopped a citywide memory collapse. | 林见夏 volunteered after the evacuation failed. |
| 69 | 林见夏不是钥匙 | They prove 林见夏 is the operator, not a consumable key, invalidating 顾衡's final plan. | Only she can authorize shutdown, but she no longer remembers 林砚. |
| 70 | 最后一次修正 | 顾衡 initiates a final correction intended to permanently seal both city layers. | The countdown fixes at 04:17 with no next day. |
| 71 | 四点十六分 | Every faction makes its final choice during the last minute before correction. | The red umbrella opens by itself. |
| 72 | 不能删除的证词 | Thousands of cross-verifying witnesses make deletion computationally and socially impossible. | The system starts deleting private memories instead. |
| 73 | 陈渡归还名字 | 陈渡 restores the three hundred names and relinquishes the stolen restoration of his family. | His family remembers him once before fading. |
| 74 | 红伞再开 | The umbrella reconnects 林砚 to 林见夏 and the ferry control room. | It can be read once more, at the price of every memory of her. |
| 75 | 最后一段六十秒 | 林砚 reads the final sixty seconds, learns the shutdown sequence, and loses his sister's face and voice. | He still retains the duty encoded in his labels. |
| 76 | 把姐姐写回人间 | Public records restore 林见夏 as a living missing person and allow her to cross back before shutdown. | 林砚 does not recognize her. |
| 77 | 雾散的代价 | The correction ends; restored residents return with uneven memories and real losses. | The city must decide how to acknowledge what happened. |
| 78 | 失物归还 | Major objects and promises are returned; 周野 remains dead/absent but publicly remembered. | One final item still lacks an owner: the red umbrella. |
| 79 | 重新认识 | 林见夏 introduces herself to 林砚, and they choose to rebuild a sibling relationship without false memory restoration. | She hands him the original claim ticket. |
| 80 | 失物招领处 | Months later the station handles an ordinary lost item; 林砚 labels the red umbrella “已归还” and closes the ledger. | End with lived continuity, not a new conspiracy. |

---

## Fixed Per-Chapter Protocol

For every chapter, in this order:

1. Primary agent reads the story bible, chapter map, previous two chapters, current continuity ledger, and open Review issues.
2. Primary agent writes the entire candidate chapter; no subagent writes or rewrites prose.
3. Run local character-count, missing-subject/sentence-fragment, location/time, rule-count, and adjacent-scene checks.
4. A subagent may return issue-only criticism with quoted evidence; it must not return replacement paragraphs.
5. Primary agent revises and computes SHA-256.
6. Import through Author Mode, run deterministic + Quick Review, and run Deep Review at window boundaries.
7. Primary agent adjudicates platform Review against the gold review and revises when valid.
8. Approve/Commit, wait for Artifact Sync, verify Review lineage and Writer-zero evidence.
9. Update ledgers and `recovery/current-state.json` atomically.
10. Do not start the next chapter while any hard failure remains.

Required `chapter-progress.csv` header:

```csv
chapter_no,volume_no,title,source_path,source_hash,non_whitespace_chinese_chars,total_chars,observable_change,new_core_rule_count,scene_template_tag,start_location,end_location,start_time,end_time,characters_present_start,characters_present_end,supporting_character_changed_situation,hook_type,summary_restatement_hit,deterministic_status,quick_review_count,deep_review_count,platform_issue_count,gold_issue_count,true_positive,false_positive,false_negative,revision_count,submission_id,submission_status,final_content_hash,final_version_id,commit_state,artifact_sync_state,reviewer_calls,artifact_calls,writer_calls,elapsed_ms,failure_count,recovery_count
```

Required recovery contract after project creation:

```ts
export interface NovelRunRecoveryState {
  projectId: string;
  lastWrittenChapter: number;
  lastImportedChapter: number;
  lastApprovedChapter: number;
  lastCommittedChapter: number;
  lastArtifactSyncedChapter: number;
  openRevisionChapter: number | null;
  lastCompletedDeepWindow: string | null;
  lastCompletedVolumeAudit: number | null;
  nextAction: string;
  updatedAt: string;
}
```

Initialize all chapter counters to `0`, nullable fields to `null`, and `nextAction` to `write chapter 1`. `projectId` must come from the actual browser/API response and `updatedAt` must be the actual UTC ISO timestamp; neither value may be invented or copied from another project.

---

### Task 1: Initialize the Tracked Authoring Package

**Files:**
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/story-bible.md`
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/chapter-map.csv`
- Create: ledger/audit/recovery/report directories listed above

- [ ] Write the story bible with the fixed cast, rules, five volume goals, voice constraints, prohibited shortcuts, and ending contract from this plan.
- [ ] Convert the authoritative chapter table above into `chapter-map.csv` with columns `chapter_no,volume_no,title,observable_change,end_hook`.
- [ ] Create empty ledger files with exact headers; do not create chapter prose yet.
- [ ] Run `git diff --check` and verify all 80 unique chapter numbers/titles are present.
- [ ] Commit:

```powershell
git add docs/superpowers/runs/2026-07-11-wucheng-80
git commit -m "docs(novel): initialize wucheng 80-chapter authoring run"
```

### Task 2: Create the New 80-Chapter Project Through the Real UI

**Files:**
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/run-manifest.json`
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/recovery/current-state.json`
- Create: `artifacts/author-mode-80/wucheng-80/browser/project-created.png`

- [ ] Start Next, Runner, and Reconciler with the verified development command.
- [ ] Use the in-app browser to create 《雾城失物招领处》 as long/fixed/80/third-person.
- [ ] Enter and lock the approved foundation; configure Reviewer/Artifact roles and leave Writer unused.
- [ ] Open `?tab=authorSubmissions` and verify the empty author workspace.
- [ ] Record the actual project ID and creation timestamp in manifest/recovery files.
- [ ] Load the recorded project ID for verification:

```powershell
$manifest = Get-Content -Raw 'docs/superpowers/runs/2026-07-11-wucheng-80/run-manifest.json' | ConvertFrom-Json
$projectId = $manifest.projectId
```

- [ ] Run `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 1 --to 0 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80`.
- [ ] Commit manifest/recovery evidence only.

### Tasks 3–22: Write and Close Twenty Four-Chapter Windows

Each task below applies the full per-chapter protocol separately to all four named files. Every task ends with a Deep Review, window audit, ledger/recovery update, targeted verification script, and one scoped commit. A failed hard gate blocks the next task.

| Task | Chapters and exact source files | Additional gate |
|---:|---|---|
| 3 | `chapters/chapter_001.md`–`chapter_004.md` | Ch.1 paste, Ch.2 single-file upload, Ch.3–4 multi-chapter import; prove all three entry modes. |
| 4 | `chapters/chapter_005.md`–`chapter_008.md` | Close child/red-umbrella temporary-name arc; no repeated “read object → vision” template. |
| 5 | `chapters/chapter_009.md`–`chapter_012.md` | Establish 周野 and public-record restoration with a completed passenger-letter promise. |
| 6 | `chapters/chapter_013.md`–`chapter_016.md` | Complete Volume 1; run `audits/volume-01.md` and one recovery rehearsal. |
| 7 | `chapters/chapter_017.md`–`chapter_020.md` | Seventeen-object mystery advances; every object must not become an isolated mini-case. |
| 8 | `chapters/chapter_021.md`–`chapter_024.md` | 陈渡's family motive and 苏栖's broadcast action both change the situation. |
| 9 | `chapters/chapter_025.md`–`chapter_028.md` | Deleted-neighborhood rules appear through consequences; expose but do not resolve 陈渡's concealment. |
| 10 | `chapters/chapter_029.md`–`chapter_032.md` | Complete Volume 2; reveal 林砚 as the eighteenth passenger and run `audits/volume-02.md`. |
| 11 | `chapters/chapter_033.md`–`chapter_036.md` | Enter the erased city and expose the failed preservation project without lecture chapters. |
| 12 | `chapters/chapter_037.md`–`chapter_040.md` | 林见夏 becomes an active agent; 陈渡 chooses the device over names. |
| 13 | `chapters/chapter_041.md`–`chapter_044.md` | Reconstruct 127 names; make 林砚's birthday loss materially affect identity verification. |
| 14 | `chapters/chapter_045.md`–`chapter_048.md` | Complete Volume 3; sibling meeting ends with “她不记得我”; run `audits/volume-03.md`. |
| 15 | `chapters/chapter_049.md`–`chapter_052.md` | Daylight erasure reaches 林砚; 苏栖 pays a concrete memory cost to anchor him. |
| 16 | `chapters/chapter_053.md`–`chapter_056.md` | Clarify the three-slot moral cost; blackout shifts authority to paper. |
| 17 | `chapters/chapter_057.md`–`chapter_060.md` | 陈渡's alteration causes harm; 周野's final route ends in public remembrance, not resurrection. |
| 18 | `chapters/chapter_061.md`–`chapter_064.md` | Complete Volume 4; 林砚 chooses 300 strangers before his sister; run `audits/volume-04.md`. |
| 19 | `chapters/chapter_065.md`–`chapter_068.md` | Build distributed evidence and reveal the ferry truth without absolving 顾衡. |
| 20 | `chapters/chapter_069.md`–`chapter_072.md` | Prove 林见夏 is an operator, start final correction, and make public testimony resist deletion. |
| 21 | `chapters/chapter_073.md`–`chapter_076.md` | 陈渡 returns names; 林砚 pays the final memory cost; 林见夏 returns alive without resurrection. |
| 22 | `chapters/chapter_077.md`–`chapter_080.md` | Complete Volume 5 and the novel; run `audits/volume-05.md` and final completion review. |

Run the matching literal command after every window:

| Window | Verification command |
|---|---|
| 001–004 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 1 --to 4 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 005–008 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 5 --to 8 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 009–012 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 9 --to 12 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 013–016 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 13 --to 16 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 017–020 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 17 --to 20 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 021–024 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 21 --to 24 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 025–028 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 25 --to 28 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 029–032 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 29 --to 32 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 033–036 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 33 --to 36 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 037–040 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 37 --to 40 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 041–044 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 41 --to 44 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 045–048 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 45 --to 48 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 049–052 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 49 --to 52 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 053–056 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 53 --to 56 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 057–060 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 57 --to 60 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 061–064 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 61 --to 64 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 065–068 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 65 --to 68 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 069–072 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 69 --to 72 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 073–076 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 73 --to 76 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |
| 077–080 | `node scripts/verify-author-mode-run.mjs --project-id $projectId --from 77 --to 80 --run-dir docs/superpowers/runs/2026-07-11-wucheng-80` |

Before each command, load `$projectId` from `run-manifest.json` with the two PowerShell lines shown in Task 2. Expected: all chapters in the window are committed, artifacts synced, current-hash Reviews only, required Deep Review present, and Writer calls equal zero.

Window audit files must contain: plot changes, character state deltas, rule debt, open hooks, repeated-scene result, platform TP/FP/FN examples, revisions, failures/recoveries, call counts, and permission to proceed.

Commit each window with the literal range, for example:

```powershell
git add docs/superpowers/runs/2026-07-11-wucheng-80
git commit -m "feat(novel): write and audit chapters 001-004"
```

### Task 23: Full Browser Regression and Export Audit

**Files:**
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/exports/雾城失物招领处.md`
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/exports/雾城失物招领处.txt`
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/checksums.sha256`
- Create: browser/download artifacts

- [ ] Use the real UI to filter all Submission states, open representative Quick/Deep reports, inspect version lineage, and verify no stale report appears current.
- [ ] Exercise Patch, rollback, invalidation warning, retry, manuscript preview, pure reader mode, copy, MD download, and TXT download.
- [ ] Repeat the critical path at 375, 768, 1279, and 1440 widths plus keyboard-only navigation.
- [ ] Run:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:ui
pnpm test:e2e
pnpm build
```

- [ ] Copy the verified runtime downloads to the tracked exports directory without changing bytes.
- [ ] Generate checksums with `Get-FileHash` and verify both exports contain exactly chapters 1–80, no duplicates, no gaps, at least 176000 non-whitespace Chinese正文 characters, and hashes matching final Versions/Submissions.

### Task 24: Final Human Read, Review Effectiveness Report, and Product Findings

**Files:**
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/reports/final-quality-report.md`
- Create: `docs/superpowers/runs/2026-07-11-wucheng-80/reports/platform-findings.md`
- Create: `artifacts/author-mode-80/wucheng-80/final-audit.json`

- [ ] Primary agent reads the complete 80-chapter export in order and records every remaining major continuity, grammar, pacing, character, rule, and closure issue.
- [ ] Reopen and repair any major issue; regenerate affected artifacts/exports/checksums.
- [ ] Compute Quick and Deep TP/FP/FN, precision, recall, common misses, common false alarms, and whether the mechanism supported or obstructed the book.
- [ ] Report UI/UX, accessibility, mobile, performance, recovery, cost/call count, and long-run reliability findings by P0/P1/P2.
- [ ] Prove the actual requirements: primary-agent authorship, Writer calls zero, 80 committed chapters, 20 Deep windows, 5 volume audits, complete exports, real browser path, and no open major issue.
- [ ] Commit final artifacts and reports.

---

## Final Completion Gate

The goal is not complete until all of the following are evidenced from current files/runtime:

- `chapter_001.md` through `chapter_080.md` exist in tracked authoring source and runtime final chapters.
- Every chapter is 2200–3200 non-whitespace Chinese正文 characters; total is at least 176000.
- Every chapter has Submission ID, final content hash, selected Version ID, committed Commit, and synced Artifact state.
- Writer calls are exactly zero for the new project.
- Deep Review exists for chapters 4, 8, 12, …, 80; five volume audits exist.
- No major continuity, identity, time, location, rule, or closure issue remains open.
- Markdown/TXT downloads have chapters 1–80 in order and recorded SHA-256 values.
- Browser, mobile, keyboard, dialog, rollback, preview, and download paths were exercised with saved evidence.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:ui`, `pnpm test:e2e`, and `pnpm build` pass at the final state.
- The final report states whether AINovel Studio can genuinely support a full novel, with evidence and limitations rather than intent.
