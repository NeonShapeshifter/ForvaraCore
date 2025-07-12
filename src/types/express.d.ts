import { ForvaraUser, Tenant } from './index';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
tenantId?: string;
userRole?: string;
user?: ForvaraUser;
tenant?: Tenant;
startTime?: number;
requestId?: string;
rawBody?: string;
}
}
}
