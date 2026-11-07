CREATE TABLE "list_households" (
	"list_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_households_list_id_household_id_pk" PRIMARY KEY("list_id","household_id")
);
--> statement-breakpoint
ALTER TABLE "list_households" ADD CONSTRAINT "list_households_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_households" ADD CONSTRAINT "list_households_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_households" ADD CONSTRAINT "list_households_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_households_household_idx" ON "list_households" USING btree ("household_id");