import {
  decodePublicKeyPem,
  JwtError,
  makeAccessTokenVerifier,
  WebCrypto,
  type AccessTokenVerifier,
} from "@store/auth";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

const unbound: AccessTokenVerifier = () =>
  Effect.fail(new JwtError({ reason: "NoKey", message: "The auth public key is not bound." }));

export class AccessTokens extends Context.Service<
  AccessTokens,
  {
    readonly verify: AccessTokenVerifier;
  }
>()("@store/server/AccessTokens") {
  static readonly layer = Layer.effect(
    AccessTokens,
    Effect.gen(function* () {
      const publicKey = yield* Config.option(Config.String("AUTH_JWT_PUBLIC_KEY"));
      if (Option.isNone(publicKey)) {
        if (globalThis.__ALCHEMY_RUNTIME__) {
          return yield* Effect.die(new Error("The auth public key is not bound."));
        }
        return AccessTokens.of({ verify: unbound });
      }
      const keys = yield* decodePublicKeyPem(publicKey.value).pipe(
        Effect.provide(WebCrypto.layer),
        Effect.orDie,
      );
      return AccessTokens.of({ verify: yield* makeAccessTokenVerifier({ keys }) });
    }),
  );
}
