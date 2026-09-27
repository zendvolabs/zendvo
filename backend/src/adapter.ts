import { Request as ExpRequest, Response as ExpResponse } from "express";
import { NextRequest } from "next/server";

export function makeExpressHandler(nextHandler: Function) {
  return async (req: ExpRequest, res: ExpResponse) => {
    try {
      const protocol = req.protocol;
      const host = req.get("host");
      const url = `${protocol}://${host}${req.originalUrl}`;

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) {
          if (Array.isArray(value)) {
            value.forEach((v) => headers.append(key, v));
          } else {
            headers.set(key, value);
          }
        }
      }

      // Pass the Express req stream directly as body so it can be parsed as JSON, Text or Form Data natively.
      // Exception: if an earlier middleware (e.g. validateRequestSignature) already
      // consumed the raw stream to hash the body, it stashes the buffered bytes on
      // `req.rawBody`. Prefer that buffer so the stream being already-drained
      // doesn't produce an empty body downstream.
      let body: any = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const bufferedBody = (req as ExpRequest & { rawBody?: Buffer }).rawBody;
        body = bufferedBody ?? req;
      }

      const webReq = new NextRequest(url, {
        method: req.method,
        headers,
        body,
        // @ts-ignore
        duplex: "half",
      });

      // Inject nextUrl helper for searchParams
      Object.defineProperty(webReq, "nextUrl", {
  value: new URL(url),
  writable: true,
  configurable: true,
});

      // Pass Express route params to Next context as Promise (matching Next.js 15/16)
      const context = {
        params: Promise.resolve(req.params),
      };

      const webRes = await nextHandler(webReq, context);

      res.status(webRes.status);
      
      // Copy headers from webRes to Express res
      webRes.headers.forEach((value: string, key: string) => {
        if (key.toLowerCase() !== "content-encoding") {
          res.setHeader(key, value);
        }
      });

      // Extract cookies explicitly using getSetCookie if available
      if (typeof webRes.headers.getSetCookie === 'function') {
        const setCookies = webRes.headers.getSetCookie();
        if (setCookies.length > 0) {
          res.setHeader("Set-Cookie", setCookies);
        }
      } else {
        const setCookie = webRes.headers.get("set-cookie");
        if (setCookie) {
          res.setHeader("Set-Cookie", setCookie);
        }
      }

      const text = await webRes.text();
      res.send(text);
    } catch (error) {
      console.error("[EXPRESS_ADAPTER_ERROR]", error);
      res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "An unexpected error occurred in the backend express handler adapter."
      });
    }
  };
}