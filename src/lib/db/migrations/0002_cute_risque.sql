CREATE TABLE "manual_standings_input" (
	"tournament_id" text PRIMARY KEY NOT NULL,
	"table_data" jsonb NOT NULL,
	"stat_leaders" jsonb NOT NULL,
	"final_result" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "manual_standings_input" ADD CONSTRAINT "manual_standings_input_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE cascade ON UPDATE no action;