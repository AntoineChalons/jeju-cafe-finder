// Stable application configuration. Cafe records, opening hours and
// translations are loaded from the generated SQLite database. They do not
// live in this public repository.
var REGIONS = ["North", "East", "South", "West"];

// Monday-first, matching the `day` values in the database.
var DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Opening hours are always evaluated in Korea time, whatever the visitor's
// device time zone is.
var CAFE_TIME_ZONE = "Asia/Seoul";

// A cafe counts as "open early" when it opens at or before this time on at
// least one day of the week.
var EARLY_OPENING = "08:00";

// Show the "Recommended for you" panel. Set to true to enable it.
var SHOW_RECOMMENDATIONS = false;

// Enum filters. Blank values in the data mean "unknown" and never match a
// selected option.
var SIZES = ["tiny", "medium", "large"];
var PRICES = [1, 2, 3];

// `computed: true` criteria are derived from opening hours in app.js.
var CRITERIA = [
  { key: "openNow", icon: "clock", computed: true },
  { key: "workFriendly", icon: "laptop" },
  { key: "localRoast", icon: "flame" },
  { key: "sellsBeans", icon: "bean" },
  { key: "outdoor", icon: "trees" },
  { key: "dessert", icon: "cake-slice" },
  { key: "brunch", icon: "egg-fried" },
  { key: "view", icon: "mountain-snow" },
  { key: "openEarly", icon: "sunrise", computed: true },
  { key: "openSunday", icon: "calendar-check", computed: true },
  { key: "arcDiscount", icon: "id-card" },
  { key: "loyalty", icon: "stamp" },
  { key: "books", icon: "book-open" },
  { key: "boardGames", icon: "dices" },
  { key: "pets", icon: "paw-print" },
  { key: "kids", icon: "baby" },
];
