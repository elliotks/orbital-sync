import Honeybadger from '@honeybadger-io/js';
import { FetchError } from 'node-fetch';
import nodemailer from 'nodemailer';
import { Config } from './config.js';
import { Log } from './log.js';

export class Notify {
  private static errorQueue: NotificationInterface[] = [];
  private static _honeybadger?: Honeybadger;
  private static _smtpClient?: nodemailer.Transporter;

  static async ofThrow(error: unknown, queue = false): Promise<void> {
    if (error instanceof ErrorNotification) {
      queue ? Notify.queueError(error) : await Notify.ofFailure(error);
    } else if (error instanceof FetchError && error.code === 'ECONNREFUSED') {
      const messageSubstring = error.message.split('ECONNREFUSED')[0]!;
      const url = Config.allHostBaseUrls.find((url) => messageSubstring.includes(url));

      await Notify.ofThrow(
        new ErrorNotification({
          message: `The host "${url}" refused to connect. Is it down?`,
          verbose: error.message
        }),
        queue
      );
    } else {
      if (error instanceof Error || typeof error === 'string')
        this.honeybadger?.notify(error);
      await Notify.ofFailure({
        message: `An unexpected error was thrown:\n- ${error?.toString() ?? error}`
      });
    }
  }

  static async ofSuccess({
    message,
    verbose,
    sendNotification,
    exit
  }: NotificationInterface): Promise<void> {
    Log.info(`✔️ Success: ${message}`);
    if (Config.verboseMode && verbose) Log.info(verbose);

    if (sendNotification ?? Config.notifyOnSuccess) {
      await this.dispatch('✔️ Success', message);
    }

    if (exit) process.exit(1);
  }

  static ofFailure({ exit }: NotificationInterface & { exit: true }): never;
  static ofFailure({ exit }: NotificationInterface): Promise<void>;
  static async ofFailure({
    message,
    verbose,
    sendNotification,
    exit
  }: NotificationInterface): Promise<void> {
    Log.error(`⚠ Failure: ${message}`);
    if (Config.verboseMode && verbose) Log.error(verbose);

    const errors = this.errorQueue.map((notif) => notif.message);
    this.errorQueue = [];

    if (sendNotification ?? Config.notifyOnFailure) {
      let formatted = message;
      if (errors.length > 0) {
        formatted = formatted.concat(
          '\n\nThe following errors occurred during sync:\n  - ',
          errors.join('\n  - ')
        );
      }

      await this.dispatch(`⚠ Failed`, formatted);
    }

    if (exit) process.exit(1);
  }

  static queueError(error: NotificationInterface): void {
    Log.error(error.message);
    if (Config.verboseMode && error.verbose) Log.error(error.verbose);

    this.errorQueue.push(error);
  }

  private static get honeybadger(): Honeybadger | undefined {
    if (Config.honeybadgerApiKey === undefined) return;

    this._honeybadger ??= Honeybadger.configure({
      apiKey: Config.honeybadgerApiKey
    });

    return this._honeybadger;
  }

  private static async dispatch(subject: string, contents: string): Promise<void> {
    if (this.smtpClient) {
      await this.smtpClient.sendMail({
        from: Config.smtpFrom ? `"Orbital Sync" <${Config.smtpFrom}>` : undefined,
        to: Config.smtpTo,
        subject: `Orbital Sync: ${subject}`,
        text: `Orbital Sync\n${subject}\n\n${contents}`,
        html: `<p><h2>Orbital Sync</h2>${subject}</p><p>${contents.replace(
          '\n',
          '<br />'
        )}</p>`
      });
    }
  }

  private static get smtpClient(): nodemailer.Transporter | undefined {
    if (!Config.notifyViaSmtp) return;

    this._smtpClient ??= nodemailer.createTransport({
      host: Config.smtpHost,
      port: Number.parseInt(Config.smtpPort),
      secure: Config.smtpTls,
      auth: {
        user: Config.smtpUser,
        pass: Config.smtpPassword
      }
    });

    return this._smtpClient;
  }
}

export class ErrorNotification extends Error implements NotificationInterface {
  constructor(args: NotificationInterface) {
    super(args.message);
    Object.assign(this, args);
  }
}

export interface NotificationInterface {
  message: string;
  verbose?: string | Record<string, unknown>;
  sendNotification?: boolean;
  exit?: boolean;
}
