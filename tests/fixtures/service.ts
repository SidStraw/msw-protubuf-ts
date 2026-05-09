import { MessageType, ScalarType } from "@protobuf-ts/runtime";
import {
	type MethodInfo,
	type PartialMethodInfo,
	type ServiceInfo,
	ServiceType,
} from "@protobuf-ts/runtime-rpc";

export interface SayHelloRequest {
	name: string;
}

export interface SayHelloResponse {
	message: string;
}

export const SayHelloRequestType = new MessageType<SayHelloRequest>(
	"example.SayHelloRequest",
	[{ no: 1, name: "name", kind: "scalar", T: ScalarType.STRING }],
);

export const SayHelloResponseType = new MessageType<SayHelloResponse>(
	"example.SayHelloResponse",
	[{ no: 1, name: "message", kind: "scalar", T: ScalarType.STRING }],
);

const greeterMethods = [
	{
		name: "SayHello",
		localName: "sayHello",
		I: SayHelloRequestType,
		O: SayHelloResponseType,
	},
	{
		name: "WatchGreetings",
		localName: "watchGreetings",
		serverStreaming: true,
		I: SayHelloRequestType,
		O: SayHelloResponseType,
	},
	{
		name: "UploadGreeting",
		localName: "uploadGreeting",
		clientStreaming: true,
		I: SayHelloRequestType,
		O: SayHelloResponseType,
	},
	{
		name: "ChatGreetings",
		localName: "chatGreetings",
		clientStreaming: true,
		serverStreaming: true,
		I: SayHelloRequestType,
		O: SayHelloResponseType,
	},
] satisfies readonly [
	PartialMethodInfo<SayHelloRequest, SayHelloResponse>,
	PartialMethodInfo<SayHelloRequest, SayHelloResponse>,
	PartialMethodInfo<SayHelloRequest, SayHelloResponse>,
	PartialMethodInfo<SayHelloRequest, SayHelloResponse>,
];

export const GreeterService = new ServiceType(
	"example.Greeter",
	greeterMethods,
);

export const TypedGreeterService = GreeterService as ServiceInfo & {
	methods: readonly [
		MethodInfo<SayHelloRequest, SayHelloResponse>,
		MethodInfo<SayHelloRequest, SayHelloResponse>,
		MethodInfo<SayHelloRequest, SayHelloResponse>,
		MethodInfo<SayHelloRequest, SayHelloResponse>,
	];
};

export const LooseGreeterService: ServiceInfo = GreeterService;

export const [
	sayHelloMethod,
	watchGreetingsMethod,
	uploadGreetingMethod,
	chatGreetingsMethod,
] = TypedGreeterService.methods;
