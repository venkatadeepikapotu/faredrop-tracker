#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = require("aws-cdk-lib");
const faredrop_stack_1 = require("../lib/faredrop-stack");
const app = new cdk.App();
new faredrop_stack_1.FareDropStack(app, 'FareDropStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    tags: {
        Project: 'faredrop-tracker',
        Environment: 'development',
        Course: 'CISE-UF',
        Program: 'AMEX-WiCSE',
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFyZWRyb3AuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmYXJlZHJvcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSx1Q0FBcUM7QUFDckMsbUNBQW1DO0FBQ25DLDBEQUFzRDtBQUV0RCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQixJQUFJLDhCQUFhLENBQUMsR0FBRyxFQUFFLGVBQWUsRUFBRTtJQUN0QyxHQUFHLEVBQUU7UUFDSCxPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7UUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztLQUN0RDtJQUNELElBQUksRUFBRTtRQUNKLE9BQU8sRUFBRSxrQkFBa0I7UUFDM0IsV0FBVyxFQUFFLGFBQWE7UUFDMUIsTUFBTSxFQUFFLFNBQVM7UUFDakIsT0FBTyxFQUFFLFlBQVk7S0FDdEI7Q0FDRixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXHJcbmltcG9ydCAnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJztcclxuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgRmFyZURyb3BTdGFjayB9IGZyb20gJy4uL2xpYi9mYXJlZHJvcC1zdGFjayc7XHJcblxyXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xyXG5cclxubmV3IEZhcmVEcm9wU3RhY2soYXBwLCAnRmFyZURyb3BTdGFjaycsIHtcclxuICBlbnY6IHtcclxuICAgIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXHJcbiAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcclxuICB9LFxyXG4gIHRhZ3M6IHtcclxuICAgIFByb2plY3Q6ICdmYXJlZHJvcC10cmFja2VyJyxcclxuICAgIEVudmlyb25tZW50OiAnZGV2ZWxvcG1lbnQnLFxyXG4gICAgQ291cnNlOiAnQ0lTRS1VRicsXHJcbiAgICBQcm9ncmFtOiAnQU1FWC1XaUNTRScsXHJcbiAgfSxcclxufSk7Il19