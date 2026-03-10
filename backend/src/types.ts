import type { DealBucket } from "./normalize.js";

export type Deal = {
  deal_name: string | null;
  owner_code: string | null;
  client_code: string | null;

  sector: string | null;
  sector_key: string | null;

  deal_status: string | null;
  deal_stage: string | null;

  bucket: DealBucket;

  amount: number | null;
  close_date: Date | null;
  close_qtr: string | null;

  created_date: Date | null;
  closure_probability: number | null;
};

export type WorkOrder = {
  deal_name: string | null;
  customer: string | null;

  sector: string | null;
  sector_key: string | null;

  execution_status: string | null;

  probable_start: Date | null;
  probable_end: Date | null;
  data_delivery_date: Date | null;

  amount_excl_gst: number | null;
  billed_excl_gst: number | null;
  collected_incl_gst: number | null;
  receivable: number | null;

  invoice_status: string | null;
  billing_status: string | null;
  collection_status: string | null;
  collection_date: Date | null;
};