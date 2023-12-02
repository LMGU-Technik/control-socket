/*
* LMGU-Technik Control-socket

* Copyright (C) 2023 Hans Schallmoser

* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.

* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.

* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { SignalVariable } from "typedSignal/mod.ts";
import { ControlSocket } from "./socket.ts";
import { AsyncGeneratorCallback } from "async_generator_callback";
import { Repeater } from "@repeaterjs/repeater";
import { ConnState, ConnStateReason } from "./state.ts";
import { Cast } from "typedSignal/src/cast.ts";

export class UnexpectedError extends Error {
    constructor(msg: string, err: unknown) {
        console.log(
            "%c<UNEXPECTED ERROR>",
            "background-color: #f00;color: #000",
        );
        console.log(msg, err);
        super(msg);
        this.name = "UnexpectedError";
    }
}

export abstract class TCPControlSocket extends ControlSocket {
    constructor(readonly host: string, readonly port: number) {
        super();
        this.connect();
    }

    private onSend = new AsyncGeneratorCallback<Uint8Array>();
    public readonly connState = new SignalVariable<ConnState>(
        ConnState.DISCONNECTED,
    );
    public readonly connected = new Cast(
        this.connState,
        ($) => $ === ConnState.CONNECTED,
    );
    public readonly connStateReason = new SignalVariable<ConnStateReason>(
        ConnStateReason.DISCONNECTED,
    );
    public readonly econnresetLimit = new SignalVariable<boolean>(false);
    private stats_econnreset_time: number[] = [];
    private stats_connStart_time = 0;

    private async connect() {
        try {
            for await (
                const data of new Repeater<Uint8Array>(async (push, stop) => {
                    this.connState.setValue(ConnState.CONNECTING);

                    this.stats_connStart_time = performance.now();

                    const conn = await Deno.connect({
                        hostname: this.host,
                        port: this.port,
                        transport: "tcp",
                    }).catch((err) => {
                        this.connState.setValue(ConnState.DISCONNECTED);
                        stop();

                        if (err instanceof Error) {
                            if (err.name === "ConnectionRefused") {
                                this.connStateReason.setValue(
                                    ConnStateReason.ECONNREFUSED,
                                );
                            } else {
                                throw new UnexpectedError(
                                    `[TCPControlSocket::connect::Deno.connect] unexpected error '${err.name}'`,
                                    err,
                                );
                            }
                        } else {
                            throw new UnexpectedError(
                                `[TCPControlSocket::connect::Deno.connect] unexpected error type`,
                                err,
                            );
                        }
                        return null;
                    });

                    if (conn === null) { // err
                        return;
                    }

                    // connected
                    conn.setNoDelay(true);
                    this.connState.setValue(ConnState.CONNECTED);
                    this.connStateReason.setValue(ConnStateReason.CONNECTED);

                    // recv
                    (async () => {
                        for await (const data of conn.readable) {
                            push(data);
                        }
                        stop();
                    })().catch((err) => {
                        if (err instanceof Error) {
                            if (err.name === "ConnectionReset") {
                                this.connState.setValue(ConnState.DISCONNECTED);
                                this.connStateReason.setValue(
                                    ConnStateReason.ECONNRESET,
                                );
                                this.stats_econnreset_time.push(
                                    performance.now() -
                                        this.stats_connStart_time,
                                );
                                stop();
                            } else {
                                throw new UnexpectedError(
                                    `[TCPControlSocket::connect::recv] unexpected error '${err.name}'`,
                                    err,
                                );
                            }
                        } else {
                            throw new UnexpectedError(
                                `[TCPControlSocket::connect::recv] unexpected error type`,
                                err,
                            );
                        }
                    });

                    // send
                    (async () => {
                        for await (const data of this.onSend) {
                            await conn.write(data).catch((err) => {
                                if (err instanceof Error) {
                                    if (err.name === "BadResource") {
                                        this.connState.setValue(
                                            ConnState.DISCONNECTED,
                                        );
                                        this.connStateReason.setValue(
                                            ConnStateReason.BAD_RESOURCE,
                                        );
                                        // handle here to prevent data loss
                                        this.onSend[Symbol.dispose]();
                                        this.onSend.call(data); // data would be lost
                                        stop();
                                    } else {
                                        throw new UnexpectedError(
                                            `[TCPControlSocket::connect::send] unexpected error '${err.name}'`,
                                            err,
                                        );
                                    }
                                } else {
                                    throw new UnexpectedError(
                                        `[TCPControlSocket::connect::send] unexpected error type`,
                                        err,
                                    );
                                }
                            });
                        }
                    })().catch((err) => {
                        throw new UnexpectedError(
                            `[TCPControlSocket::connect::send] unexpected error`,
                            err,
                        );
                    });

                    await stop;
                    // stopped

                    this.connState.setValue(ConnState.DISCONNECTING);

                    if (
                        !this.connStateReason.equals(
                            ConnStateReason.BAD_RESOURCE,
                        )
                    ) { // already handled
                        this.onSend[Symbol.dispose]();
                    }

                    try { // might be closed already
                        conn.close();
                    } catch (err) {
                        if (err instanceof Error) {
                            if (err.name === "BadResource") {
                                // connection already closed
                            } else {
                                throw new UnexpectedError(
                                    `[TCPControlSocket::connect::close] unexpected error '${err.name}'`,
                                    err,
                                );
                            }
                        } else {
                            throw new UnexpectedError(
                                `[TCPControlSocket::connect::close] unexpected error type`,
                                err,
                            );
                        }
                    }

                    this.connState.setValue(ConnState.DISCONNECTED);
                })
            ) {
                this.recv(data);
            }
        } catch (err) {
            if (err) { // all errors should already have been handled
                throw new UnexpectedError(
                    `[TCPControlSocket::connect] unexpected error`,
                    err,
                );
            }
        } finally {
            while (this.stats_econnreset_time.length > 5) {
                this.stats_econnreset_time.shift();
            }

            const avg_econnreset_time =
                this.stats_econnreset_time.reduce((prev, curr) =>
                    prev + curr, 0) /
                this.stats_econnreset_time.length;

            if (
                avg_econnreset_time < 500 &&
                this.stats_econnreset_time.length > 3
            ) {
                this.econnresetLimit.setValue(true);
                setTimeout(() => {
                    this.connect();
                }, 5000);
            } else {
                this.connect();
                this.econnresetLimit.setValue(false);
            }
        }
    }
    send(data: Uint8Array) {
        this.onSend.call(data);
    }
}
