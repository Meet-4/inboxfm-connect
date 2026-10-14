import { createAction, Property } from "@inboxfm-connect/pieces-framework";
import { housecallProAuth, baseUrl } from "../common";
import { HttpMethod, httpClient } from "@inboxfm-connect/pieces-common";

export const addJobAttachment = createAction({
  auth: housecallProAuth,
  name: "add_job_attachment",
  displayName: "Add an attachment to a job",
  description: "Upload an attachment to a job",
  audience: 'both',
  aiMetadata: { description: "Upload a file attachment to a Housecall Pro job identified by job ID, sent as multipart form data. Not idempotent: repeated calls add duplicate attachments.", idempotent: false },
  props: {
    job_id: Property.ShortText({
      displayName: "Job ID",
      description: "The ID of the job to add attachment to",
      required: true,
    }),
    file: Property.File({
      displayName: "File",
      description: "The file to upload",
      required: true,
    }),
  },
  async run({ auth, propsValue }) {
    const { job_id, file } = propsValue;

    const formData = new FormData();
    const blob = new Blob([file.data] as unknown as BlobPart[], { type: "application/octet-stream" });
    formData.append("file", blob, file.filename);

    const response = await httpClient.sendRequest({
      url: `${baseUrl}/jobs/${job_id}/attachments`,
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

