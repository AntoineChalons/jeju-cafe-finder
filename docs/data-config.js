// Stable application configuration. Cafe records, opening hours and
// translations are loaded from the generated SQLite database. They do not
// live in this public repository.
var REGIONS = ["North", "East", "South", "West"];
var KINDS = ["cafe", "roastery", "bakery", "pub"];

// Monday-first, matching the `day` values in the database.
var DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Opening hours are always evaluated in Korea time, whatever the visitor's
// device time zone is.
var CAFE_TIME_ZONE = "Asia/Seoul";

// A cafe counts as "open early" when it opens strictly before this time on at
// least one day of the week.
var EARLY_OPENING = "10:00";

// Show the "Recommended for you" panel. Set to true to enable it.
var SHOW_RECOMMENDATIONS = false;

// Enum filters. Blank values in the data mean "unknown" and never match a
// selected option.
var SIZES = ["tiny", "medium", "large"];
var PRICES = [1, 2, 3];

// Personal tags have stable suggested keys; labels live in i18n.js.
var SUGGESTED_TAGS = ["visited", "want-to-go", "favourite", "great-coffee", "great-vibe", "quiet"];
var TAG_MAX_LENGTH = 30;
var TAG_MAX_PER_CAFE = 20;

// Internal behavior only. Labels, visibility and order live in filters-config.json.
// `computed: true` criteria are derived from opening hours in app.js.
var CRITERION_DEFINITIONS = [
  { key: "openNow", icon: "clock", computed: true },
  { key: "openTomorrow", icon: "calendar-check", computed: true },
  { key: "workFriendly", icon: "laptop" },
  { key: "outdoor", icon: "trees" },
  { key: "dessert", icon: "cake-slice" },
  { key: "brunch", icon: "egg-fried" },
  { key: "view", icon: "mountain-snow" },
  { key: "openEarly", icon: "sunrise", computed: true },
  { key: "books", icon: "book-open" },
  { key: "boardGames", icon: "dices" },
  { key: "pets", icon: "paw-print" },
  { key: "kids", icon: "baby" },
  { key: "loyalty", icon: "stamp" },
  { key: "localRoast", icon: "coffee" },
  { key: "sellsBeans", icon: "bean" },
  { key: "openSunday", icon: "calendar-days", computed: true },
  { key: "arcDiscount", icon: "badge-percent" },
];

// Populated by filters-config.js before app.js starts.
var CONFIGURED_CRITERIA = [];
var CRITERIA = [];
