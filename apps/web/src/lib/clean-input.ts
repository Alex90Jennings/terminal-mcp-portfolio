/**
 * Visitor text as plain data. Removes what could change how text is shown or read, but never what it says: terminal
 * escape sequences, control characters, and invisible formatting characters (zero-width, bidirectional overrides, byte
 * order marks) that can hide or reorder text. Normalises Unicode (NFC) and collapses whitespace. Used by the terminal
 * before it runs or shows input, and by the chat route before a question reaches the model.
 */
export function cleanInput(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') // CSI sequences: colours, cursor moves
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '') // OSC sequences: titles, hyperlinks
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '') // other C0 controls, DEL, C1 controls
    .replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, '') // zero-width and bidirectional controls
    .replace(/\s+/g, ' ')
    .trim();
}
