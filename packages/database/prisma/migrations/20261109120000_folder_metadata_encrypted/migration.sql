-- Folder appearance (color + icon) lives in one encrypted JSON bundle, like
-- the metadata of notes and saved searches.
ALTER TABLE "Folder" ADD COLUMN "metadata_encrypted" TEXT;

-- The per-field columns came with 0_init and no client or server code ever
-- wrote them (always NULL), so dropping them loses nothing.
ALTER TABLE "Folder" DROP COLUMN "color_encrypted",
DROP COLUMN "icon_encrypted";
