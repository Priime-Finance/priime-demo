export * from "./journal";

// The frozen JSON Schema (source of truth). Runtime consumers (replay UI,
// live-polling API) validate journals against this with ajv:
//
//   import Ajv from "ajv/dist/2020";
//   import { journalSchema, type Journal } from "@priime-demo/journal-schema";
//   const validate = new Ajv({ strict: false }).compile<Journal>(journalSchema);
//   if (!validate(data)) throw new Error(JSON.stringify(validate.errors));
//
import journalSchema from "../../../schema/journal.v1.schema.json";
export { journalSchema };
