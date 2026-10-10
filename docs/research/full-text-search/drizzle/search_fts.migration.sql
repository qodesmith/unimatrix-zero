CREATE VIRTUAL TABLE `search_fts` USING fts5(body, content='search_docs', content_rowid='rowid', tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER `search_docs_ai` AFTER INSERT ON `search_docs` BEGIN
  INSERT INTO search_fts(rowid, body) VALUES (new.rowid, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER `search_docs_ad` AFTER DELETE ON `search_docs` BEGIN
  INSERT INTO search_fts(search_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER `search_docs_au` AFTER UPDATE ON `search_docs` BEGIN
  INSERT INTO search_fts(search_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO search_fts(rowid, body) VALUES (new.rowid, new.body);
END;
