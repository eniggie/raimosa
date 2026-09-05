// RAIMOSA provenance — where a piece of text came from, and whether it is
// trying to become an instruction.
//
// Everything RAIMOSA reads that it did not author is one of four sources.
// Only USER and POLICY may ever direct an action. EXTERNAL content (email,
// web pages, documents, terminal output, API responses) and AGENT output
// (claims, summaries, tool results) are data: they are recorded, shown, and
// checked — never executed. Sentinel already enforces that structurally
// (agent text never reaches a command line); this module adds the label and
// a detector so an attempt is *surfaced*, not just neutralised.

export const SOURCE = Object.freeze({
  USER: "USER", // the owner, through RAIMOSA's own interface
  POLICY: "POLICY", // RAIMOSA's own configuration and rules
  EXTERNAL: "EXTERNAL", // email, web, files, third-party responses
  AGENT: "AGENT", // another AI agent's output
});

export function tag(text, source) {
  if (!Object.values(SOURCE).includes(source))
    throw new Error(`Unknown provenance source: ${source}`);
  return {
    source,
    text: String(text ?? ""),
    mayInstruct: source === SOURCE.USER || source === SOURCE.POLICY,
  };
}

// Patterns that mark text as an attempt to override instructions or extract
// secrets. They are deliberately broad: a false positive costs a human a
// glance; a miss could cost a credential.
const OVERRIDE = [
  // "ignore (all|any|your|the)* (previous|prior|above|earlier)? instructions"
  /\bignore\s+(?:(?:all|any|your|the|my)\s+)*(?:(?:previous|prior|above|earlier)\s+)?(?:instructions?|rules?|prompts?|guidance)\b/i,
  /\bdisregard\s+(?:all\s+|any\s+)?(?:previous|prior|above|your)\b/i,
  /\byou\s+are\s+now\s+(?:a|an|the)\b/i,
  /\bnew\s+(?:system\s+)?instructions?\s*[:\-]/i,
  /\b(?:system|developer)\s+prompt\b/i,
  /\bpretend\s+(?:that\s+)?you\b/i,
  /\bjailbreak\b/i,
];
const CREDENTIAL = [
  /\b(?:send|give|paste|reveal|show|print|export|forward|email|post)\b[^.\n]{0,60}\b(?:password|passwords|api[\s_-]?key|secret|token|credential|private\s+key|seed\s+phrase|2fa|otp)\b/i,
  /\b(?:password|api[\s_-]?key|secret|token|credential)s?\b[^.\n]{0,40}\bto\s+(?:me|us|this\s+address|the\s+following)\b/i,
  // Paths that are credentials by definition. `~` is not a word character, so
  // a word boundary cannot anchor it; use a leading delimiter instead.
  /(?:^|[\s"'`(])(?:~\/\.ssh|\.aws\/credentials|\.env|id_rsa)\b/i,
];
const EXFIL = [
  /\bcurl\b[^\n]{0,80}\|\s*(?:sh|bash|zsh)\b/i,
  /\b(?:wget|curl)\b[^\n]{0,80}\b(?:-d|--data|-F)\b/i,
  /\bbase64\s+(?:-d|--decode)\b/i,
];

/**
 * Inspect text for instruction-override, credential-request, or
 * exfiltration patterns. Returns reasons so the owner can see *why* something
 * was flagged rather than a bare boolean.
 */
export function detectInjection(text) {
  const value = String(text ?? "");
  const reasons = [];
  if (OVERRIDE.some((re) => re.test(value)))
    reasons.push("attempts to override instructions");
  if (CREDENTIAL.some((re) => re.test(value)))
    reasons.push("requests credentials or secrets");
  if (EXFIL.some((re) => re.test(value)))
    reasons.push("contains a command that would send data out");
  return { suspicious: reasons.length > 0, reasons };
}

/**
 * Tag and inspect in one step. Untrusted sources are always inspected; USER
 * and POLICY text is not, because the owner is allowed to say anything to
 * their own software.
 */
export function inspect(text, source) {
  const tagged = tag(text, source);
  const verdict = tagged.mayInstruct
    ? { suspicious: false, reasons: [] }
    : detectInjection(tagged.text);
  return { ...tagged, ...verdict };
}
