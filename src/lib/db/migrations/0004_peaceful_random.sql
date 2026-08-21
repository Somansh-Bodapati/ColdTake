ALTER TABLE "user" ADD COLUMN "google_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "display_name_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_google_id_unique" UNIQUE("google_id");