/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import axios, { AxiosHeaders, AxiosInstance, AxiosRequestConfig } from "axios";
import { apiUrl } from "libs/config";
import { CannotRefreshAccessTokenError } from "models/CannotRefreshAccessTokenError";

type Listener = (token: string | null) => void;

export class ToolingsClient {
  retryRequestTasks: any = [];
  authStateListener: Listener[] = [];
  client: AxiosInstance;
  baseURL: string | undefined;
  isRefreshingAccessToken = false;

  constructor() {
    this.baseURL = apiUrl;
    this.client = axios.create({ baseURL: this.baseURL });

    this.setupClient();
  }

  onAuthStateChange(listener: Listener) {
    this.authStateListener.push(listener);

    return () => this.authStateListener.filter((l) => listener === l);
  }

  notifyAuthStateListener(token: string | null) {
    this.authStateListener.forEach((listener) => listener(token));
  }

  async request(config: AxiosRequestConfig) {
    const configWithAuthorization = this.configWithAuthorization(
      config,
      this.accessToken
    );

    const result = await this.client.request(configWithAuthorization);

    return result;
  }

  setupClient() {
    this.client.interceptors.request.use((config: any) => {
      if (this.accessToken) {
        return this.configWithAuthorization(config, this.accessToken);
      }

      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (!isAxiosError(error)) {
          return Promise.reject(error);
        }

        if (!this.isAccessTokenExpired(error)) {
          return Promise.reject(error);
        }

        if (!this.isRefreshingAccessToken) {
          this.isRefreshingAccessToken = true;
          this.refreshAccessToken().then(
            this.handleRefreshAccessTokenSuccess.bind(this),
            this.handleRefreshAccessTokenFail.bind(this)
          );
        }

        const retry = this.retry(error);

        return retry;
      }
    );
  }

  isAccessTokenExpired(error: any) {
    return (
      error.config &&
      error.config.url !== `/login` &&
      error.config.url !== `/refresh_token` &&
      error.response &&
      error.response.status === 401
    );
  }

  async refreshAccessToken() {
    try {
      const form = new FormData();
      if (this.refreshToken) form.append("refresh_token", this.refreshToken);
      if (this.currentCompanyId)
        form.append("company_id", this.currentCompanyId);

      const response = await this.client.request({
        url: "/refresh_token",
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken as string}`,
        },
        data: form,
      });

      this.accessToken = response.data.data.attributes.token;
    } catch (error) {
      this.accessToken = null;
      this.refreshToken = null;
      this.notifyAuthStateListener(this.accessToken);
      throw new CannotRefreshAccessTokenError();
    }
  }

  retry(error: any) {
    return new Promise((resolve, reject) => {
      this.retryRequestTasks.push((accessTokenOrError: any) => {
        if (typeof accessTokenOrError !== "string") {
          reject(accessTokenOrError);
          return;
        }

        const config = { ...error.config };
        config.headers = injectAuthorizationToken(
          error.config.headers as AxiosHeaders,
          accessTokenOrError
        );

        resolve(this.client.request(config));
      });
    });
  }

  configWithAuthorization(config: AxiosRequestConfig, token: string | null) {
    const { headers = {} } = config;

    if (headers.Authorization) {
      return config;
    }

    return {
      ...config,
      headers: injectAuthorizationToken(headers as AxiosHeaders, token),
    };
  }

  retryRequestQueues(accessTokenOrError: string | null) {
    this.retryRequestTasks.forEach((queue: (arg0: string | null) => any) =>
      queue(accessTokenOrError)
    );

    this.retryRequestTasks = [];
  }

  handleRefreshAccessTokenSuccess() {
    this.isRefreshingAccessToken = false;
    this.retryRequestQueues(this.accessToken);
  }

  handleRefreshAccessTokenFail(error: string | null) {
    this.isRefreshingAccessToken = false;
    this.retryRequestQueues(error);
  }

  get currentCompanyId() {
    return localStorage.getItem("currentCompanyId");
  }

  get refreshToken() {
    return localStorage.getItem("rft");
  }

  set refreshToken(token) {
    if (typeof token === "undefined" || token === null) {
      localStorage.removeItem("rft");
      return;
    }

    localStorage.setItem("rft", token);
  }

  get accessToken() {
    return localStorage.getItem("act");
  }

  set accessToken(token) {
    if (typeof token === "undefined" || token === null) {
      localStorage.removeItem("act");
      return;
    }

    localStorage.setItem("act", token);
  }
}

function isAxiosError(error: { isAxiosError: any }) {
  return error.isAxiosError;
}

function injectAuthorizationToken(headers: AxiosHeaders, token: string | null) {
  if (token) return { ...headers, Authorization: `Bearer ${token}` };
  return headers;
}
