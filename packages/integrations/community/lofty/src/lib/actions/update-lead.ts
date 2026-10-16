import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { loftyAuth } from '../common/auth';
import { makeRequest } from '../common/client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { leadIdDropdown } from '../common/props';

export const updateLead = createAction({
  auth: loftyAuth,
  name: 'updateLead',
  displayName: 'Update Lead',
  description: 'Update a lead in Lofty',
  audience: 'both',
  aiMetadata: {
    description:
      'Updates fields on an existing Lofty lead identified by lead id, sending only the fields you provide (name, emails, phone, address, lead type, source, buyer/seller criteria, opt-ins, etc.). Use to modify a known lead rather than create one. Idempotent: applying the same field values repeatedly leaves the lead in the same state.',
    idempotent: true,
  },
  props: {
    leadId: leadIdDropdown,
    firstName: Property.ShortText({
      displayName: 'First name',
      required: false,
    }),
    lastName: Property.ShortText({
      displayName: 'Last name',
      required: false,
    }),
    emails: Property.Array({
      displayName: 'Email',
      description: 'Lead email address(s)',
      required: false,
    }),
    phone: Property.ShortText({
      displayName: 'Phone',
      required: false,
    }),
    birthday: Property.ShortText({
      displayName: 'Birthday',
      description: 'YYYY-MM-DD',
      required: false,
    }),
    mailingAddress: Property.ShortText({
      displayName: 'Street or Complete Address (Mailing Address)',
      required: false,
    }),
    mailingCity: Property.ShortText({
      displayName: 'City (Mailing Address)',
      required: false,
    }),
    mailingState: Property.ShortText({
      displayName: 'State (Mailing Address)',
      required: false,
    }),
    mailingZipcode: Property.ShortText({
      displayName: 'Zip Code (Mailing Address)',
      required: false,
    }),
    leadType: Property.ShortText({
      displayName: 'Lead Type',
      required: false,
    }),
    leadOwnershipLevel: Property.ShortText({
      displayName: 'Lead Ownership Level',
      required: false,
    }),
    source: Property.ShortText({
      displayName: 'Source',
      required: false,
    }),
    segment: Property.ShortText({
      displayName: 'Segment',
      required: false,
    }),
    tags: Property.Array({
      displayName: 'Tag(s)',
      required: false,
    }),
    note: Property.LongText({
      displayName: 'Note',
      required: false,
    }),
    subscriptionSmartPlans: Property.Checkbox({
      displayName: 'Subscription - Smart Plans',
      required: false,
    }),
    subscriptionPropertyAlert: Property.Checkbox({
      displayName: 'Subscription - Property Alert',
      required: false,
    }),
    subscriptionMarketReport: Property.Checkbox({
      displayName: 'Subscription - Market Report',
      required: false,
    }),
    minPriceBuyer: Property.Number({
      displayName: 'Min Price (Buyer)',
      required: false,
    }),
    maxPriceBuyer: Property.Number({
      displayName: 'Max Price (Buyer)',
      required: false,
    }),
    locationDeprecated: Property.ShortText({
      displayName: 'Location (Deprecated)',
      required: false,
    }),
    buyerCity: Property.ShortText({
      displayName: 'City (Buyer)',
      required: false,
    }),
    buyerState: Property.ShortText({
      displayName: 'State (Buyer)',
      required: false,
    }),
    buyerZipcode: Property.ShortText({
      displayName: 'Zipcode (Buyer)',
      required: false,
    }),
    buyerAddress: Property.ShortText({
      displayName: 'Address (Buyer)',
      required: false,
    }),
    minBedsBuyer: Property.Number({
      displayName: 'Min Beds (Buyer)',
      required: false,
    }),
    minBathsBuyer: Property.Number({
      displayName: 'Min Baths (Buyer)',
      required: false,
    }),
    bedsSeller: Property.Number({
      displayName: 'Beds (Seller)',
      required: false,
    }),
    bathsSeller: Property.Number({
      displayName: 'Baths (Seller)',
      required: false,
    }),
    priceSeller: Property.Number({
      displayName: 'Price (Seller)',
      required: false,
    }),
    addressSeller: Property.ShortText({
      displayName: 'Address (Seller)',
      required: false,
    }),
    sqftSeller: Property.Number({
      displayName: 'SqFt (Seller)',
      required: false,
    }),
    citySeller: Property.ShortText({
      displayName: 'City (Seller)',
      required: false,
    }),
    stateSeller: Property.ShortText({
      displayName: 'State (Seller)',
      required: false,
    }),
    zipcodeSeller: Property.ShortText({
      displayName: 'Zipcode (Seller)',
      required: false,
    }),
    sendWelcomeEmail: Property.Checkbox({
      displayName: 'Send Welcome Email',
      required: false,
    }),
    callOptIn: Property.Checkbox({
      displayName: 'Call Opt In',
      required: false,
    }),
    textOptIn: Property.Checkbox({
      displayName: 'Text Opt In',
      required: false,
    }),
    emailOptIn: Property.Checkbox({
      displayName: 'Email Opt In',
      required: false,
    }),
    numberConsent: Property.Checkbox({
      displayName: 'Number Consent',
      required: false,
    }),
  },
  async run({ auth, propsValue }) {
    const { leadId } = propsValue;

    // Field names follow the documented PUT /v1.0/leads/{leadId} body schema
    // (https://developer.lofty.com/api-reference/leads/update-lead):
    // camelCase identifiers; buyer criteria go in `inquiry`, seller
    // criteria in `property`.
    const payload: any = {};

    if (propsValue.firstName) payload.firstName = propsValue.firstName;
    if (propsValue.lastName) payload.lastName = propsValue.lastName;
    if (propsValue.emails) payload.emails = propsValue.emails;
    if (propsValue.phone) payload.phones = [propsValue.phone];
    if (propsValue.source) payload.source = propsValue.source;
    if (propsValue.birthday) payload.birthday = propsValue.birthday;
    if (propsValue.mailingAddress)
      payload.streetAddress = propsValue.mailingAddress;
    if (propsValue.mailingCity) payload.city = propsValue.mailingCity;
    if (propsValue.mailingState) payload.state = propsValue.mailingState;
    if (propsValue.mailingZipcode)
      payload.zipCode = propsValue.mailingZipcode;
    if (propsValue.segment) payload.segments = [propsValue.segment];
    if (propsValue.tags) payload.tags = propsValue.tags;
    if (propsValue.callOptIn !== undefined)
      payload.cannotCall = !propsValue.callOptIn;
    if (propsValue.textOptIn !== undefined)
      payload.cannotText = !propsValue.textOptIn;
    if (propsValue.emailOptIn !== undefined)
      payload.cannotEmail = !propsValue.emailOptIn;

    const inquiry: Record<string, unknown> = {};
    if (propsValue.minPriceBuyer !== undefined)
      inquiry['priceMin'] = propsValue.minPriceBuyer;
    if (propsValue.maxPriceBuyer !== undefined)
      inquiry['priceMax'] = propsValue.maxPriceBuyer;
    if (propsValue.minBedsBuyer !== undefined)
      inquiry['bedroomsMin'] = propsValue.minBedsBuyer;
    if (propsValue.minBathsBuyer !== undefined)
      inquiry['bathroomsMin'] = String(propsValue.minBathsBuyer);
    const location: Record<string, unknown> = {};
    if (propsValue.buyerAddress) location['streetAddress'] = propsValue.buyerAddress;
    if (propsValue.buyerCity) location['city'] = propsValue.buyerCity;
    if (propsValue.buyerState) location['state'] = propsValue.buyerState;
    if (propsValue.buyerZipcode) location['zipCode'] = propsValue.buyerZipcode;
    if (Object.keys(location).length > 0) inquiry['locations'] = [location];
    if (Object.keys(inquiry).length > 0) payload.inquiry = inquiry;

    const property: Record<string, unknown> = {};
    if (propsValue.priceSeller !== undefined)
      property['price'] = propsValue.priceSeller;
    if (propsValue.addressSeller)
      property['streetAddress'] = propsValue.addressSeller;
    if (propsValue.citySeller) property['city'] = propsValue.citySeller;
    if (propsValue.stateSeller) property['state'] = propsValue.stateSeller;
    if (propsValue.zipcodeSeller)
      property['zipCode'] = propsValue.zipcodeSeller;
    if (propsValue.bedsSeller !== undefined)
      property['bedrooms'] = propsValue.bedsSeller;
    if (propsValue.bathsSeller !== undefined)
      property['bathrooms'] = propsValue.bathsSeller;
    if (propsValue.sqftSeller !== undefined)
      property['squareFeet'] = propsValue.sqftSeller;
    if (Object.keys(property).length > 0) payload.property = property;

    const response = await makeRequest(
      auth.secret_text,
      HttpMethod.PUT,
      `/leads/${leadId}`,
      payload
    );

    return response;
  },
});

