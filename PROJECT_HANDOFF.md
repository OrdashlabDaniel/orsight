# PROJECT_HANDOFF

## Project Overview
This project is a POD screenshot audit and form-filling web tool.

Current project root:
`c:\works\Career\Position\GOFO\works\pod-audit-tool`

Main goal:
- User uploads POD screenshots
- AI extracts table data
- System flags risky or wrong results
- User manually reviews and corrects
- User downloads Excel
- Corrected records can be saved into a training pool

This is currently a single-user workflow product, not a team collaboration system.

## Core Business Rules
These rules are critical and must not be broken.

1. `抽查路线` must come from the task area route code, not the top-right station/team label.
2. `运单数量` must come only from `应领件数`.
3. `未收数量` must come only from `未领取`.
4. `错扫数量` must come only from `错分数量`.
5. If `运单数量` is unreliable, the system must clear the value instead of leaving a wrong number in the table.
6. Suspicious records must be marked for manual review.
7. All flagged records should support:
   - `再次识别`
   - `查看图片`
   - `打开标注`
   - manual box annotation
   - saving into training pool

## Current Model Strategy
Default strategy:
- Batch recognition: `gpt-5-mini`
- Retry / re-recognition: `gpt-5`

The system already includes:
- multi-pass consistency checking
- suspicious counter validation
- training-example assisted prompting

## Current Validation Logic
The system currently tries to reduce errors through multiple layers:

1. Multi-run consistency check
   - Same image is recognized 4 times
   - If results differ, record is flagged

2. Source-label validation
   - AI must provide `totalSourceLabel`
   - If `运单数量` does not clearly come from `应领件数`, record is flagged

3. Counter-region verification
   - The system separately checks:
   - `应领件数`
   - `实领件数`
   - `已领`
   - If `应领件数` is unreadable or `运单数量` looks like it came from `实领件数` or `已领`, record is flagged and `运单数量` is cleared

4. Manual recovery path
   - flagged rows can be reviewed, re-run, opened in image viewer, annotated manually, and added to training pool

## Key UX Decisions
These UX choices are intentional and should be preserved unless explicitly redesigned.

### Table behavior
- Records are grouped by route
- Fully duplicated records are deduplicated
- Flagged rows should be visually highlighted
- The row corresponding to the currently opened popup should be highlighted

### Image viewer
- `查看图片` opens an independent floating popup
- This popup is different from the annotation popup
- It should appear over the left upload-panel area, not cover the table
- It should help users inspect the image while editing the row
- It supports zoom and pan

### Annotation popup
- `打开标注` opens a separate annotation popup
- Annotation popup is for manual training-box marking
- It should not be merged with the image-viewer popup
- Annotation popup is expected to evolve further later

## Training Pool
Current local training pool structure:

- Training metadata:
  - `training/examples.json`
- Training images:
  - `image/training-ai`

Current behavior:
- Training examples are loaded and inserted into prompts as few-shot examples
- Manual annotation can save image + boxes + correct output back into training pool

Important:
- This is not real online model fine-tuning
- It is example-assisted prompting plus structured review/training data accumulation

## Current Important Files
Main app:
- `webapp/src/app/page.tsx`

Main extraction API:
- `webapp/src/app/api/extract/route.ts`

Training pool helpers:
- `webapp/src/lib/training.ts`

Prompt and validation rules:
- `webapp/src/lib/pod.ts`

Supporting scripts and docs:
- `pod_fill_guard.py`
- `pod_form_rules.md`
- `pod_vision_prompt.txt`
- `webapp_agent_plan.md`

## Current Completed Features
Already implemented:

- batch screenshot upload
- drag-and-drop upload
- online editable table
- route grouping
- duplicate row deduplication
- batch AI recognition
- retry recognition for flagged rows
- flagged row highlighting
- manual delete of flagged records
- image viewer popup
- annotation popup
- save annotation into training pool
- download Excel
- downloaded Excel file name uses record date
- project and key folder names converted to English-safe paths

## Current Known Risks / Attention Points
1. Image viewer and annotation popup are separate and should remain separate.
2. Viewer popup should always help table-side manual correction, not block the table.
3. If suspicious numeric evidence is detected, bad values should be cleared, not retained.
4. Future deployment must replace local file storage with cloud object storage and database-backed metadata.
5. Current training pool is still local-file based and should later move to cloud storage + DB.

## Current Deployment Direction
Planned production direction:

- App server: `Next.js`
- Auth: `Clerk` or `Supabase Auth`
- Database: `Postgres`
- Temp upload storage: cloud object storage
- Training pool storage: separate cloud object storage area
- AI: OpenAI API
- Future billing: subscription / quota based

Current product scope:
- single-user product first
- not team collaboration yet

## Recommended Next Steps
Near-term priorities:
1. stabilize image viewer popup behavior
2. stabilize annotation popup workflow
3. add registration/login
4. move data and image storage to cloud
5. persist records/history in database
6. add user usage tracking
7. prepare for paid subscription model later

## Important Constraint For Future AI Sessions
When continuing this project:
- Do not rebuild already finished features from scratch
- Read existing code first
- Preserve current business rules
- Preserve the distinction between:
  - image viewer popup
  - annotation popup
- Preserve the rule that suspicious totals must be cleared instead of silently kept

## Quick Summary For New Session
This is a single-user POD screenshot form-filling tool with AI extraction, route grouping, anomaly flagging, image review popup, annotation popup, and a local training pool. The most important logic is that suspicious `运单数量` must not be trusted, and flagged rows must enter manual handling workflow.
