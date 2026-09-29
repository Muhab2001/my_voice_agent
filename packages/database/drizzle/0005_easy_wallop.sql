CREATE TABLE "hotel_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"price_sar" integer NOT NULL,
	"weekly_availability" jsonb NOT NULL,
	"active" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_name" varchar(128) NOT NULL,
	"location_name" varchar(128) NOT NULL,
	"city" varchar(128) NOT NULL,
	"active" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"hotel_id" uuid,
	"stay_date" varchar(10),
	"guest_name" varchar(128),
	"rooms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quoted_total_sar" integer,
	"confirmed_total_sar" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hotel_offerings" ADD CONSTRAINT "hotel_offerings_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_offerings_name_unique" ON "hotel_offerings" USING btree ("hotel_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "hotels_location_unique" ON "hotels" USING btree ("brand_name","location_name");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_draft" ON "reservations" USING btree ("status") WHERE "reservations"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "reservations_date_idx" ON "reservations" USING btree ("stay_date");--> statement-breakpoint
ALTER TABLE "hotel_offerings" ADD CONSTRAINT "hotel_offerings_price_nonnegative" CHECK ("price_sar" >= 0);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_status_valid" CHECK ("status" IN ('draft', 'abandoned', 'confirmed'));
--> statement-breakpoint
INSERT INTO "hotels" ("brand_name", "location_name", "city") VALUES
  ('Marriott', 'Marriott - Riyadh', 'Riyadh'),
  ('Marriott', 'Marriott - Al Khobar', 'Al Khobar'),
  ('Hilton', 'Hilton - Riyadh', 'Riyadh'),
  ('Hilton', 'Hilton - Jeddah', 'Jeddah')
ON CONFLICT ("brand_name", "location_name") DO NOTHING;
--> statement-breakpoint
WITH seeded_offerings AS (
  SELECT hotels.id AS hotel_id, room.name, room.price_sar,
    floor(random() * 7)::integer AS zero_day
  FROM hotels
  CROSS JOIN (VALUES
    ('King Room', 420),
    ('Double Bed', 520),
    ('Suite', 770)
  ) AS room(name, price_sar)
  WHERE hotels.location_name IN (
    'Marriott - Riyadh', 'Marriott - Al Khobar',
    'Hilton - Riyadh', 'Hilton - Jeddah'
  )
)
INSERT INTO hotel_offerings (hotel_id, name, price_sar, weekly_availability)
SELECT seeded_offerings.hotel_id, seeded_offerings.name, seeded_offerings.price_sar,
  jsonb_agg(
    CASE WHEN day_index = seeded_offerings.zero_day THEN 0
      ELSE 2 + floor(random() * 4)::integer END
    ORDER BY day_index
  )
FROM seeded_offerings
CROSS JOIN generate_series(0, 6) AS day_index
GROUP BY seeded_offerings.hotel_id, seeded_offerings.name,
  seeded_offerings.price_sar, seeded_offerings.zero_day
ON CONFLICT (hotel_id, name) DO NOTHING;
