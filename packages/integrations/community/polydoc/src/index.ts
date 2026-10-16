import { createPiece } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { captureScreenshot } from './lib/actions/capture-screenshot';
import { convertToPdf } from './lib/actions/convert-pdf';
import { generateEinvoice } from './lib/actions/generate-einvoice';
import { polydocAuth } from './lib/common/auth';
import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';

export const polydoc = createPiece({
  displayName: 'PolyDoc',
  description:
    'Convert HTML or a URL to PDF, capture screenshots, and generate EU e-invoices (Factur-X / ZUGFeRD).',
  auth: polydocAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/polydoc.png',
  categories: [PieceCategory.CONTENT_AND_FILES, PieceCategory.PRODUCTIVITY],
  authors: ['polydoc-tech', 'sanket-a11y'],
  actions: [
    convertToPdf,
    captureScreenshot,
    generateEinvoice,
    createCustomApiCallAction({
      // PolyDoc's API base (same as lib/common/constants.ts DEFAULT_BASE_URL).
      // api.podio.com is the unrelated Podio product — every call 401'd/404'd.
      baseUrl: () => 'https://api.polydoc.tech',
      auth: polydocAuth,
      authMapping: async (auth: any) => ({
        Authorization: `Bearer ${auth.props.apiKey}`,
        'X-Sandbox': auth.props.sandbox ? 'true' : 'false',
      }),
    }),
  ],
  triggers: [],
});
