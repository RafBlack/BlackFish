const BF_BRAND_LIST = [
  "google.com", "accounts.google.com", "gmail.com", "microsoft.com",
  "live.com", "outlook.com", "office.com", "apple.com", "icloud.com",
  "yahoo.com", "aol.com", "protonmail.com",

  "paypal.com", "stripe.com", "chase.com", "bankofamerica.com",
  "wellsfargo.com", "citibank.com", "capitalone.com", "americanexpress.com",
  "discover.com", "usbank.com", "hsbc.com", "barclays.co.uk",
  "coinbase.com", "binance.com", "kraken.com", "venmo.com",
  "revolut.com", "wise.com", "westernunion.com",

  "amazon.com", "aws.amazon.com", "dropbox.com", "box.com",
  "adobe.com", "salesforce.com", "slack.com", "zoom.us",
  "github.com", "gitlab.com", "atlassian.com", "notion.so",

  "facebook.com", "instagram.com", "whatsapp.com", "linkedin.com",
  "twitter.com", "x.com", "netflix.com", "ebay.com", "walmart.com",

  "fedex.com", "ups.com", "usps.com", "dhl.com",

  "verizon.com", "att.com", "t-mobile.com", "comcast.com"
];

const BF_BRAND_FAMILIES = {
  "gmail.com": "google.com",
  "youtube.com": "google.com",
  "icloud.com": "apple.com",
  "live.com": "microsoft.com",
  "outlook.com": "microsoft.com",
  "office.com": "microsoft.com",
  "instagram.com": "facebook.com",
  "whatsapp.com": "facebook.com",
  "aws.amazon.com": "amazon.com"
};

function bfSameBrandFamily(a, b) {
  if (a === b) return true;
  return BF_BRAND_FAMILIES[a] === b || BF_BRAND_FAMILIES[b] === a;
}

const BF_LURE_KEYWORDS = [
  "login", "signin", "verify", "verification", "secure", "security",
  "account", "update", "confirm", "billing", "payment", "suspended",
  "unlock", "reset", "password", "support", "webscr", "authenticate"
];
