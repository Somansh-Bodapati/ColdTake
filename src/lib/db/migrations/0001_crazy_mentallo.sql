ALTER TABLE "auth_token" ADD COLUMN "email" text;--> statement-breakpoint
CREATE INDEX "auth_token_user_id_purpose_idx" ON "auth_token" USING btree ("user_id","purpose");--> statement-breakpoint
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_token_hash_unique" UNIQUE("token_hash");