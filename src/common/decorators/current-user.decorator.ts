import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface CurrentUserData {
  id: string;
  walletAddress: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as CurrentUserData;
    return data ? user?.[data] : user;
  },
);
