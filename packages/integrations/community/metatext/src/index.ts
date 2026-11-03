import { createPiece, PieceAuth } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { extractText } from './lib/actions/extract-text';
import { classifyText } from './lib/actions/classify-text';
import { finetuneModel } from './lib/actions/finetune-model';
import { metatextAuth } from './lib/auth';

export const metatext = createPiece({
  displayName: 'Metatext',
  description: 'AI content moderation and safety guard API\n\nDEPRECATED (Nov 2026 liveness census): The API host api.metatext.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and metatext.ai now hosts an unrelated product, so this action cannot reach its API.',
  auth: metatextAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/metatext.png',
  categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE],
  authors: ['onyedikachi-david'],
  actions: [extractText, classifyText, finetuneModel],
  triggers: [],
});

