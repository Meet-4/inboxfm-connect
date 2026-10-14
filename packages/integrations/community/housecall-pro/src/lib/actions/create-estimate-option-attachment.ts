import { createAction, Property } from "@inboxfm-connect/pieces-framework";
import { housecallProAuth, baseUrl } from "../common";
import { HttpMethod, httpClient } from "@inboxfm-connect/pieces-common";

export const createEstimateOptionAttachment = createAction({
  auth: housecallProAuth,
  name: "create_estimate_option_attachment",
  displayName: "Create estimate option attachment",
  description: "Upload an attachment to an estimate option",
  audience: 'both',
  aiMetadata: {
    description: "Upload a file as an attachment to a specific option of a Housecall Pro estimate, identified by estimate ID and option ID. Not idempotent: each call uploads another attachment, so repeating it creates duplicates.",
    idempotent: false,
  },
  props: {
    estimate_id: Property.ShortText({ displayName: "Estimate ID", required: true }),
    option_id: Property.ShortText({ displayName: "Option ID", required: true }),
    file: Property.File({ displayName: "File", required: true }),
  },
  async run({ auth, propsValue }) {
    const { estimate_id, option_id, file } = propsValue;

    const formData = new FormData();
    const blob = new Blob([file.data] as unknown as BlobPart[], { type: "application/octet-stream" });
    formData.append("file", blob, file.filename);

    const response = await httpClient.sendRequest({
      url: `${baseUrl}/estimates/${estimate_id}/options/${option_id}/attachments`,
      method: HttpMethod.POST,
      headers: {
        "Authorization": `Token ${auth}`,
        // No manual Content-Type: fetch derives it from the FormData body
        // and appends the multipart boundary — a manual boundary-less
        // header makes the request unparseable.
      },
      body: formData,
    });

    return response.body;
  },
});



