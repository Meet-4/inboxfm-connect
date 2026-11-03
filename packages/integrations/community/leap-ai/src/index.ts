import { createPiece, PieceAuth } from '@inboxfm-connect/pieces-framework';
import { leapAiAuth } from './lib/common/auth';
import { getAWorkflowRun } from './lib/actions/get-a-workflow-run';
import { runAWorkflow } from './lib/actions/run-a-workflow';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';

export const leapAi = createPiece({
  displayName: 'Leap AI',
  auth: leapAiAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/leap-ai.png',
  categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE],
  description:
    'Automate any workflow with AI. Build custom AI automations to scale your marketing, sales, and operations.\n\nDEPRECATED (Nov 2026 liveness census): Leap retired its Workflows API; api.workflows.tryleap.ai no longer accepts TLS connections and the current Leap API at api.tryleap.ai has no workflow endpoints, so this action cannot reach its API.',
  authors: ['sanket-a11y'],
  actions: [getAWorkflowRun, runAWorkflow],
  triggers: [],
});

