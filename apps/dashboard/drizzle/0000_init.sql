CREATE TYPE "public"."panel_type" AS ENUM('3x-ui', 'marzban', 'static');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('unknown', 'online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('free', 'premium');--> statement-breakpoint
CREATE TABLE "ad_rewards" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"install_id" text NOT NULL,
	"minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"install_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_clients" (
	"device_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"client_uuid" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_clients_device_id_server_id_pk" PRIMARY KEY("device_id","server_id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"install_id" text NOT NULL,
	"platform" text DEFAULT 'ios' NOT NULL,
	"app_version" text,
	"premium_until" timestamp with time zone,
	"premium_source" text,
	"free_until" timestamp with time zone,
	"banned" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_install_id_unique" UNIQUE("install_id")
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"city" text,
	"host" text NOT NULL,
	"port" integer DEFAULT 443 NOT NULL,
	"tier" "tier" DEFAULT 'free' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"reality_public_key" text NOT NULL,
	"reality_short_id" text DEFAULT '' NOT NULL,
	"reality_sni" text NOT NULL,
	"fingerprint" text DEFAULT 'chrome' NOT NULL,
	"flow" text DEFAULT 'xtls-rprx-vision' NOT NULL,
	"panel_type" "panel_type" DEFAULT '3x-ui' NOT NULL,
	"panel_url" text,
	"panel_username" text,
	"panel_password" text,
	"panel_inbound" text,
	"static_uuid" text,
	"status" "server_status" DEFAULT 'unknown' NOT NULL,
	"latency_ms" integer,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_clients" ADD CONSTRAINT "device_clients_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_clients" ADD CONSTRAINT "device_clients_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;