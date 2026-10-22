CREATE SEQUENCE "public"."sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plural" text,
	"category_id" text NOT NULL,
	"default_unit" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pantry" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"mealie_food_id" text,
	"category_locked" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text,
	"last_sync_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_id" uuid NOT NULL,
	"catalog_item_id" uuid,
	"name" text NOT NULL,
	"amounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"properties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"category_id" text,
	"checked" boolean DEFAULT false NOT NULL,
	"checked_at" text,
	"checked_by" uuid,
	"position" text NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"merged_into" uuid,
	"hlc" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_members" (
	"list_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	CONSTRAINT "list_members_list_id_user_id_pk" PRIMARY KEY("list_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"list_type" text DEFAULT 'shopping' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"icon" text,
	"color" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hlc" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"oidc_subject" text NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"default_list_id" uuid,
	"hlc" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_oidc_subject_unique" UNIQUE("oidc_subject")
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_mealie_idx" ON "catalog_items" USING btree ("mealie_food_id");--> statement-breakpoint
CREATE INDEX "catalog_items_seq_idx" ON "catalog_items" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_owner_type_idx" ON "integrations" USING btree ("owner_id","type");--> statement-breakpoint
CREATE INDEX "list_items_list_seq_idx" ON "list_items" USING btree ("list_id","seq");--> statement-breakpoint
CREATE INDEX "list_members_user_idx" ON "list_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lists_seq_idx" ON "lists" USING btree ("seq");