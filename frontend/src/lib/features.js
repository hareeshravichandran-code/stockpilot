/**
 * What Kanalyst shows right now. Product promise (K-136): "One view of your family's money:
 * what you own, what you owe, what's due." Modules outside it stay in the code, switched off here.
 * Turn one back on by setting it to true; nothing else needs to change.
 */
export const FEATURES = {
  blueprint: false,     // goals on a visual plan
  retirement: false,    // retirement planner
};

export const TAGLINE = "Your family's money, in one place";
export const PROMISE = "What you own, what you owe, what's due.";

/** A category's symbol for display: emoji only. Old rows hold icon names like "more_horiz", which must never show as text. */
export const catGlyph = (icon) => (icon && /[^\x00-\x7F]/.test(icon) ? icon : '');
