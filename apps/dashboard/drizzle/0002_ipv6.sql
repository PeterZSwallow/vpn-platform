ALTER TABLE "device_clients" ADD COLUMN "ipv6_address" text;--> statement-breakpoint
ALTER TABLE "device_clients" ADD COLUMN "ipv6_rotations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_clients" ADD COLUMN "ipv6_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "ipv6_prefix" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "expose_ipv4" boolean DEFAULT true NOT NULL;