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

import { Repeater } from "@repeaterjs/repeater";

export function testServer(port: number) {
    return new Repeater(async (push, stop) => {
        const server = Deno.listen({
            port,
        });

        for await (const conn of server) {
            conn.write(new TextEncoder().encode("Hello"));
            try {
                for await (const chunk of conn.readable) {
                    push(chunk);
                }
            } catch (err) {
                if (err instanceof Error) {
                    if (err.name === "ConnectionReset") {
                        console.log(err.message);
                    } else {
                        throw err;
                    }
                } else {
                    throw err;
                }
            }
        }

        await stop;
        server.close();
    });
}

for await (const data of testServer(9000)) {
    console.log(data);
}
