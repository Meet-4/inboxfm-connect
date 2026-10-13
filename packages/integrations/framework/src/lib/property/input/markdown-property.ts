import * as z from "zod/mini";
import { BasePropertySchema, TPropertyValue } from './common';
import { PropertyType } from './property-type';
import { MarkdownVariant } from '@inboxfm-connect/core-piece-types';

export const MarkDownProperty = z.object({
  ...BasePropertySchema.shape,
  // Property.MarkDown() always emits variant (default INFO); the TS type below
  // declares it, so the zod schema must validate and retain it too — otherwise
  // every parse of piece metadata silently strips the markdown styling variant.
  variant: z.optional(z.enum(MarkdownVariant)),
  ...TPropertyValue(z.void(), PropertyType.MARKDOWN).shape,
});

export type MarkDownProperty = BasePropertySchema &
  TPropertyValue<
    undefined,
    PropertyType.MARKDOWN,
    false
  > & {
    variant?: MarkdownVariant;
  };
