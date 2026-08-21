CREATE TABLE "question_result" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"answer" jsonb NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"settled_by" text NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "voided_by" text;--> statement-breakpoint
ALTER TABLE "question_result" ADD CONSTRAINT "question_result_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_result_question_id_settled_at_idx" ON "question_result" USING btree ("question_id","settled_at" DESC NULLS LAST);