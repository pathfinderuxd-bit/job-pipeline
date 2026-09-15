/* config.js — the lookup tables the tracker renders from.
 *
 * SRC_BADGE  job board / ATS -> [badge markup, css class]. The badge is plain
 *            initials, except LinkedIn which uses their own mark.
 * TYPE_ICONS contract type -> inline SVG (stroke: currentColor, 16px).
 * CV_OPTIONS the choices in every row's CV dropdown.
 * CV_SEED    the CV a new row starts on, picked from its contract type.
 *
 * Add a board or a CV variant by editing the objects below; nothing else
 * needs to change.
 */
window.SRC_BADGE = {
  "Indeed": [
    "ID",
    "v-in"
  ],
  "LinkedIn": [
    "<img src=\"data:image/png;base64,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\" alt=\"LinkedIn\" width=\"71\" height=\"60\">",
    "v-li"
  ],
  "JobServe": [
    "JS",
    "v-js"
  ],
  "Welcome to the Jungle": [
    "J",
    "v-wj"
  ],
  "Adzuna ApplyIQ": [
    "Az",
    ""
  ],
  "Workable": [
    "Wk",
    ""
  ],
  "Workday": [
    "Wd",
    ""
  ],
  "Teamtailor": [
    "Tt",
    ""
  ],
  "Ashby": [
    "As",
    ""
  ],
  "Flexhire": [
    "Fx",
    ""
  ],
  "Webitrent": [
    "Wb",
    ""
  ],
  "Direct": [
    "D",
    ""
  ],
  "Reed": [
    "Rd",
    ""
  ],
  "Recruitee": [
    "Rc",
    ""
  ],
  "Personio": [
    "Pe",
    ""
  ],
  "Rippling": [
    "Rp",
    ""
  ],
  "Broadbean": [
    "Bb",
    ""
  ],
  "Greenhouse": [
    "Gh",
    ""
  ],
  "Unknown": [
    "?",
    ""
  ]
};

window.TYPE_ICONS = {
  "Full-Time": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/></svg>",
  "Part-Time": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/><path d=\"M5.6 18.4 18.4 5.6\"/></svg>",
  "Fractional": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 12V3\"/><path d=\"M12 12h9\"/></svg>",
  "Freelance": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"4\" y=\"5\" width=\"16\" height=\"11\" rx=\"1.5\"/><path d=\"M2 19h20\"/></svg>",
  "Contract": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z\"/><path d=\"M14 3v5h5\"/><path d=\"M9 13h6\"/><path d=\"M9 17h4\"/></svg>",
  "Temporary": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M8 3v4\"/><path d=\"M16 3v4\"/><path d=\"M3 11h18\"/></svg>"
};

window.CV_OPTIONS = [
  "—",
  "General CV",
  "Full-time CV",
  "Contract CV",
  "Part-Time CV",
  "Temporary CV"
];

window.CV_SEED = {
  "Full-Time": "Full-time CV",
  "Contract": "Contract CV",
  "Temporary": "Temporary CV",
  "Freelance": "Contract CV",
  "Fractional": "Contract CV",
  "Part-Time": "Part-Time CV"
};
