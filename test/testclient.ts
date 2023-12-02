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

import { TCPControlSocket } from "../src/tcp.ts";

function* num() {
    let i = 0;
    while (true) {
        yield i++;
    }
}

export class TestClient extends TCPControlSocket {
    constructor() {
        super("127.0.0.1", 9000);
        const nums = num();
        setInterval(() => {
            this.send(new Uint8Array([nums.next().value || 0]));
        }, 500);
    }
    protected recv(data: Uint8Array): void {
        console.log("recv", data);
    }
}

new TestClient();
