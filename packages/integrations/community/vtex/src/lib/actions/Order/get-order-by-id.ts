import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { Order } from '../../common/Order';
import { vtexAuth } from '../../..';

export const getOrderById = createAction({
  auth: vtexAuth,
  name: 'get-order-by-id',
  displayName: 'Get Order By ID',
  description: 'Find a Order by Id',
  audience: 'both',
  aiMetadata: {
    description:
      'Retrieve a single order from the VTEX store order management system (OMS) by its order ID. Use when you already know the order ID and need its details. Read-only and idempotent.',
    idempotent: true,
  },
  props: {
    OrderId: Property.ShortText({
      displayName: 'Order ID',
      description:
        'The Order ID, e.g. 1172452900788-01 (VTEX order IDs are strings with a -NN suffix)',
      required: true,
    }),
  },
  async run(context) {
    const { hostUrl, appKey, appToken } = context.auth.props;
    const { OrderId } = context.propsValue;

    const order = new Order(hostUrl, appKey, appToken);

    return await order.getOrderById(OrderId);
  },
});
