CREATE TABLE "fx_rates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fx_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"month" text NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_pair_month_key" UNIQUE("base_currency","quote_currency","month"),
	CONSTRAINT "fx_rates_base_currency_format" CHECK ("fx_rates"."base_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fx_rates_quote_currency_format" CHECK ("fx_rates"."quote_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fx_rates_distinct_currencies" CHECK ("fx_rates"."base_currency" <> "fx_rates"."quote_currency"),
	CONSTRAINT "fx_rates_month_format" CHECK ("fx_rates"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "fx_rates_rate_positive" CHECK ("fx_rates"."rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "fx_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "fx_rates_month_idx" ON "fx_rates" USING btree ("month");