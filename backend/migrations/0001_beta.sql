CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER installation_limit BEFORE INSERT ON installations
WHEN NEW.active = 1 AND (SELECT COUNT(*) FROM installations WHERE active = 1) >= 25
BEGIN SELECT RAISE(ABORT, 'installation_limit'); END;
CREATE TRIGGER installation_reactivation_limit BEFORE UPDATE OF active ON installations
WHEN OLD.active = 0 AND NEW.active = 1 AND (SELECT COUNT(*) FROM installations WHERE active = 1) >= 25
BEGIN SELECT RAISE(ABORT, 'installation_limit'); END;
CREATE TABLE usage (
  installation TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('lookup','report','ai','globalAi')),
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(installation,day,kind)
);
CREATE TRIGGER usage_insert_limit BEFORE INSERT ON usage
WHEN NEW.count > CASE NEW.kind WHEN 'lookup' THEN 1000 WHEN 'report' THEN 5 WHEN 'ai' THEN 10 ELSE 100 END
BEGIN SELECT RAISE(ABORT, 'daily_quota'); END;
CREATE TRIGGER usage_update_limit BEFORE UPDATE ON usage
WHEN NEW.count > CASE NEW.kind WHEN 'lookup' THEN 1000 WHEN 'report' THEN 5 WHEN 'ai' THEN 10 ELSE 100 END
BEGIN SELECT RAISE(ABORT, 'daily_quota'); END;
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  installation TEXT NOT NULL REFERENCES installations(id),
  request_id TEXT NOT NULL,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  hostname TEXT NOT NULL,
  features TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
  reuse_consent INTEGER NOT NULL CHECK(reuse_consent = 1),
  created_at INTEGER NOT NULL,
  UNIQUE(installation,request_id)
);
CREATE INDEX reports_retention ON reports(created_at);
CREATE TRIGGER report_quota BEFORE INSERT ON reports BEGIN
  INSERT INTO usage(installation,day,kind,count) VALUES(NEW.installation,strftime('%Y-%m-%d',NEW.created_at/1000,'unixepoch'),'report',1)
  ON CONFLICT(installation,day,kind) DO UPDATE SET count = count + 1;
END;
CREATE TABLE threats (
  id TEXT PRIMARY KEY,
  report_id TEXT,
  scope TEXT NOT NULL CHECK(scope IN ('url','hostname')),
  hostname TEXT NOT NULL,
  url_hash TEXT,
  provenance TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > reviewed_at AND expires_at <= reviewed_at + 86400000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  CHECK((scope = 'url' AND length(url_hash) = 64) OR (scope = 'hostname' AND url_hash IS NULL))
);
CREATE INDEX threats_url ON threats(url_hash,hostname,revoked,expires_at);
CREATE INDEX threats_host ON threats(hostname,scope,revoked,expires_at);
CREATE TRIGGER threat_confirms_report AFTER INSERT ON threats BEGIN
  UPDATE reports SET status='confirmed' WHERE id=NEW.report_id;
END;
CREATE TABLE service_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO service_meta(key,value) VALUES('examples_version','1');
CREATE TABLE example_groups (kind TEXT NOT NULL,name TEXT NOT NULL,split TEXT NOT NULL,PRIMARY KEY(kind,name));
CREATE TABLE examples (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK(label IN ('benign','phishing')),
  features TEXT NOT NULL,
  explanation TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  evidence TEXT NOT NULL,
  family TEXT NOT NULL,
  domain_group TEXT NOT NULL,
  split TEXT NOT NULL CHECK(split IN ('retrieval','tuning','evaluation')),
  reviewed_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX examples_retrieval ON examples(split,active,label);
CREATE TRIGGER example_split_guard BEFORE INSERT ON examples BEGIN
  INSERT OR IGNORE INTO example_groups(kind,name,split) VALUES('family',NEW.family,NEW.split);
  INSERT OR IGNORE INTO example_groups(kind,name,split) VALUES('domain',NEW.domain_group,NEW.split);
  SELECT CASE WHEN EXISTS(SELECT 1 FROM example_groups WHERE ((kind='family' AND name=NEW.family) OR (kind='domain' AND name=NEW.domain_group)) AND split<>NEW.split) THEN RAISE(ABORT,'example_split_leakage') END;
END;
CREATE TRIGGER example_version_insert AFTER INSERT ON examples BEGIN UPDATE service_meta SET value=CAST(value AS INTEGER)+1 WHERE key='examples_version'; END;
CREATE TRIGGER example_version_update AFTER UPDATE ON examples BEGIN UPDATE service_meta SET value=CAST(value AS INTEGER)+1 WHERE key='examples_version'; END;
CREATE TRIGGER example_version_delete AFTER DELETE ON examples BEGIN UPDATE service_meta SET value=CAST(value AS INTEGER)+1 WHERE key='examples_version'; END;
CREATE TABLE ai_jobs (
  key TEXT PRIMARY KEY,
  installation TEXT NOT NULL REFERENCES installations(id),
  day TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','complete','error','timeout')),
  result TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ai_expiry ON ai_jobs(expires_at);
CREATE TRIGGER ai_quota BEFORE INSERT ON ai_jobs BEGIN
  INSERT INTO usage(installation,day,kind,count) VALUES(NEW.installation,NEW.day,'ai',1)
  ON CONFLICT(installation,day,kind) DO UPDATE SET count = count + 1;
  INSERT INTO usage(installation,day,kind,count) VALUES('__global__',NEW.day,'globalAi',1)
  ON CONFLICT(installation,day,kind) DO UPDATE SET count = count + 1;
END;
