import sayHello from "./say-hello";
import watchGreetings from "./watch-greetings";

export const greeterHandlers = [sayHello, watchGreetings] as const;
