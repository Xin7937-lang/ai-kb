# Clipboard image paste into notes

## Problem Statement

Note authors cannot paste an image copied to the system or browser clipboard
directly into a TipTap note. They must save the image locally and use the
editor's image import flow, which interrupts the writing workflow.

The editor already has file-based image insertion and the storage layer has an
image upload contract, but the current branch is missing the HTTP upload and
public static-serving seams that the editor expects. Clipboard paste cannot be
made end-to-end without restoring those minimal seams.

## Solution

When the TipTap note editor receives a paste event, inspect the synchronous
clipboard item list for the first supported image. If one exists, take image
priority over text or HTML, upload it through the authenticated existing image
upload flow, and insert the resulting image node at the position captured when
the paste occurred.

If no supported image is present, return control to TipTap's normal paste
handling. A second image paste while an upload is in progress is ignored. The
implementation reuses the existing image MIME allowlist, 10 MB limit, storage
layout, public URL format, authentication boundary, path-traversal guard,
spinner, and alert-based upload error feedback.

## User Stories

1. As a note author, I want to paste a copied screenshot into the focused
   note editor, so that I can capture visual information without saving a
   temporary file first.
2. As a note author, I want the pasted image to appear at the exact position
   where I pasted it, so that continuing to type does not move the image to an
   unexpected location.
3. As a note author, I want to continue editing while the image uploads, so
   that a slow network request does not freeze the whole editor.
4. As a note author, I want the existing upload spinner to show while a pasted
   image is uploading, so that I know the image action is still in progress.
5. As a note author, I want the first supported image to win when the
   clipboard contains image data together with text or HTML, so that a copied
   screenshot is not silently reduced to an unrelated text fragment.
6. As a note author, I want ordinary text and HTML pastes to keep their
   existing TipTap behavior, so that this feature does not regress normal
   writing and formatting workflows.
7. As a note author, I want a clipboard containing only an unsupported image
   format to fall back to normal paste handling without an unexpected modal,
   so that unsupported content does not disrupt editing.
8. As a note author, I want a second image paste during an active upload to be
   ignored rather than uploaded concurrently, so that images cannot be
   reordered or inserted at ambiguous positions.
9. As a note author, I want a failed upload to show the existing visible error
   feedback, so that I know why the image did not appear.
10. As a note author, I want a failed upload to leave no broken image node in
    the document, so that a failed network request does not corrupt my note.
11. As a note author, I want pasted images to use the same supported formats as
    file-selected images, so that clipboard paste does not create a second
    incompatible image pipeline.
12. As a note author, I want the existing 10 MB upload limit to apply to
    pasted images, so that clipboard paste follows the same resource limits as
    file selection.
13. As a note author, I want the inserted image to use the existing TipTap
    image-node representation, so that it remains editable and renderable
    after the note is saved.
14. As a note author, I want the note to store an uploaded image URL rather
    than base64 data, so that note content remains compact and compatible with
    existing rendering and export behavior.
15. As a signed-in user, I want clipboard image uploads to require the same
    authenticated upload session as file-selected images, so that anonymous
    users cannot write files to the knowledge base.
16. As a signed-in user, I want uploaded images to remain viewable after
    saving and reopening a note, so that the clipboard workflow produces
    durable notes rather than temporary editor state.
17. As a system operator, I want uploaded images to retain the existing
    year/month storage layout and public URL format, so that backup and NAS
    deployment behavior remain compatible.
18. As a system operator, I want public image serving to retain its
    path-traversal protection and immutable caching behavior, so that adding
    clipboard paste does not weaken the upload security boundary.
19. As a maintainer, I want the file-picker and clipboard paths to share the
    same upload endpoint, so that validation, storage, and error behavior do
    not diverge.
20. As a maintainer, I want no database migration for this feature, so that
    existing notes, assets, and deployments remain upgrade-compatible.
21. As a maintainer, I want the feature behavior documented as current state,
    so that future contributors know clipboard image paste is supported.
22. As a maintainer, I want a focused regression test for clipboard item
    selection, so that changes to editor paste handling cannot silently remove
    image support.
23. As a maintainer, I want a manual browser check for successful and failed
    image paste, so that browser-only clipboard behavior is verified at the
    highest practical seam without adding a new test framework.

## Implementation Decisions

- Add the minimum authenticated multipart image-upload HTTP seam required by
  the existing editor and storage helper. It accepts one file, delegates
  validation and persistence to the existing storage layer, and returns the
  established `{ data: ... }` success or `{ error, message }` failure shape.
- Add the minimum public static image-serving seam required by existing image
  URLs. It resolves paths under the configured upload directory, rejects
  traversal, derives the MIME type from the stored extension, and preserves
  immutable caching.
- Extend the client-only TipTap editor's paste handling rather than changing
  note CRUD or the persisted TipTap schema.
- Read only synchronous `ClipboardEvent` items. Do not use the asynchronous
  Clipboard API or request additional clipboard permissions.
- Select the first clipboard item whose MIME type is in the existing image
  allowlist. A supported image takes priority over text and HTML. If there is
  no supported image, preserve default TipTap paste behavior.
- Capture the editor selection at paste time and resolve it after upload before
  inserting the image node. The editor remains editable during the request.
- Treat the upload as single-flight for clipboard images. While one image is
  uploading, ignore later image paste events; do not queue or run concurrent
  uploads.
- Reuse the existing upload helper, MIME mapping, 10 MB limit, asset record,
  public URL format, authentication check, spinner state, and alert-based
  error feedback.
- Insert the image only after a successful upload response contains a valid
  public URL. On any failure, do not dispatch an image insertion.
- Do not add tables, migrations, a new image format, a new storage location,
  clipboard write support, image compression, OCR, or drag-and-drop behavior.
- Update current-state references in the repository's product, contract, and
  contributor documentation after the behavior ships.

## Testing Decisions

- Tests should assert externally observable clipboard behavior: supported
  image selection, image priority over text, fallback for ordinary or
  unsupported content, and single-image selection. They should not assert
  private editor implementation details.
- Use one focused pure seam for clipboard item selection, extracted at the
  highest reusable point possible. Feed it representative clipboard item
  shapes and verify the selected image or default-paste decision.
- Follow repository prior art: add a manual `npx tsx` test runner rather than
  introducing Jest, Vitest, or another test framework.
- Verify the existing upload contract at the route/storage seam with the
  repository's available smoke coverage where the native SQLite dependency is
  available.
- Perform a manual browser check in both a new note and an existing note:
  paste a PNG, continue typing before completion, save, reopen, and confirm
  the image renders. Also check a failed upload and ordinary text paste.
- Run the required regression order: typecheck, lint, production build, all
  relevant smoke scripts, and all available manual unit tests.

## Out of Scope

- Supporting multiple images in one paste operation.
- Queuing or concurrent clipboard image uploads.
- Reading the clipboard outside a user-triggered paste event.
- Requesting clipboard permissions or adding a clipboard history/browser
  integration.
- Clipboard copy/export, image editing, compression, OCR, thumbnailing, or
  deduplication.
- Changing the TipTap document schema, note API payloads, FTS, embeddings,
  backup format, or database migrations.
- Refactoring unrelated upload, editor, note, or static-serving code.
- Introducing a browser automation test framework.

## Further Notes

- The existing product documentation describes image upload as shipped, while
  the current branch lacks the HTTP/static route files referenced by the
  editor and contracts. Restoring those minimal seams is a dependency of this
  feature, not an unrelated upload redesign.
- The implementation should be developed in separate slices, with a
  typecheck/lint run after each slice and one final code-review pass followed
  by a dedicated fix commit if findings remain.
- The issue should be triaged with the repository's `ready-for-agent` label.
