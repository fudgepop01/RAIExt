import { IScript, IFuncCall, IVariable, ICommand, IFuncDef, PassedArg, IScope, IExpression, Operator } from './definitions';
import { Buffer } from "buffer";
import { U16, U32, U8, Struct, RawString, Pointer16, Pointer32, Endian, NullTerminatedString, StructType } from 'construct-js';
import { write as floatWrite } from 'ieee754';
// for floating point support
import { IBuiltins } from './getIncludeData';
import BaseField from './construct-js-field';

const IEEE754_FLOAT32_MAX = (2 - (2 ** -23)) * (2 ** 127);
const IEEE754_FLOAT32_MIN = IEEE754_FLOAT32_MAX * -1;

const f32Tou8s = (vals: number[], isLittleEndian: boolean) => {
  const stride = 4;
  const buff = new Uint8Array(vals.length * stride);
  for (let [i, val] of vals.entries()) {
    floatWrite(buff, val, i * stride, isLittleEndian, 23, 4);
  }
  return buff;
}

class F32Type extends BaseField {
  constructor(value: number, endian: Endian = Endian.Little) {
    super(4, IEEE754_FLOAT32_MIN, IEEE754_FLOAT32_MAX, f32Tou8s, value, endian);
  }
}

const F32 = (value: number, endian: Endian = Endian.Little) => new F32Type(value, endian);

const fToI = (value: number): Buffer => {
  const tempBuffer = Buffer.from(new Array(4));
  floatWrite(tempBuffer, value, 0, true, 23, 4);
  return tempBuffer;
}

export const generateStruct = (
  depthTarget: number,
  mainScript: IScript,
  scripts: IScript[], 
  fns: IFuncDef[], 
  globals: IVariable[],
  anonymousScopes: {[key: number]: IScope[]},
  builtins: IBuiltins
) => {
  console.log(">> DEPTH:", depthTarget)
  const builtinCommands: {[key: string]: IFuncDef} = {};
  for (const cmd of builtins.cmds)
    builtinCommands[cmd.name] = cmd;

  const builtinGlobals = {};
  for (const global of builtins.globals)
    builtinGlobals[global.name] = global;

  const argumentFactory = (arg: PassedArg) => {
    const argument = Struct('arg');
    // console.log("-- ARGUMENT:", arg);
    switch (arg.kind) {
      case 'number': 
        argument.field('data', U16((0 << 0) | (arg.id << 3), Endian.Little));
        break;
      case 'string': 
        argument.field('data', U16((1 << 0) | (arg.id << 3), Endian.Little));
        break;
      case 'function': 
        argument.field('data', U16((2 << 0) | (arg.id << 3), Endian.Little));
        // console.log("arg: ", arg.id);
        for (const [i, a] of (arg as IFuncCall).arguments.entries()) {
          argument.field(`arg${i}`, argumentFactory(a));
        }
        break;
      case 'identifier': 
        argument.field('data', U16((3 << 0) | (arg.id << 3), Endian.Little));
        // console.log("var:", arg.id);
        break;
      case 'builtin':
        argument.field('data', U16((4 << 0) | (arg.id << 3), Endian.Little));
        break;
      case 'builtin-rel':
        argument.field('data', U16((5 << 0) | (arg.id << 3), Endian.Little));
        break;
      case 'expression':
        // console.log("arg:", (arg as IExpression));
        argument.field('data', U16((6 << 0) | ((arg as IExpression).op << 3), Endian.Little));
        argument.field('lhs', argumentFactory((arg as IExpression).lhs))
        if ((arg as IExpression).op != Operator.NOT) {
          argument.field('rhs', argumentFactory((arg as IExpression).rhs))
        }
        break;
      case 'script':
        argument.field('data', U16(arg.id, Endian.Little));
        // console.log("arg: ", arg.id);
        for (const [i, a] of (arg as IFuncCall).arguments.entries()) {
          argument.field(`arg${i}`, argumentFactory(a));
        }
        break;
      case 'raw':
        argument.field('data', U16(arg.id, Endian.Little));
        break;
      }
    // 
    return argument;
  }

  const commandFactory = (cmd: ICommand) => {
    // console.log(cmd);
    // console.log(builtinCommands[cmd.name].name);
    const commandType = Struct('commandType')
      .field('data', U16(builtinCommands[cmd.name].raw!, Endian.Little));
      // .field('data', U16LE((cmd.arguments.length << 12) | builtinCommands[cmd.name].raw!));

    const command = Struct('command')
      .field('commandType', commandType)
      // .field('nextCommandOffset', U8(cmd.arguments.length))

    for (const [i, arg] of cmd.arguments.entries()) {
      command.field(`arg${i}`, argumentFactory(arg));
    }
    return command;
  }

  const scopeFactory = (scope: IScope) => {
    const scopeOutput = Struct('scope')
      .field('commandCount', U16(scope.commands.length, Endian.Little));

    const rawDataList = Struct('scopeRawDataList');
    for (const [i, number] of scope.rawValues.entries()) {
      // rawDataList.field(`float${i}`, U32LE(number));
      // @ts-ignore
      rawDataList.field(`float${i}`, F32(number, Endian.Little));
    }

    const rawStringList = Struct('scopeRawStringList');
    for (const [i, str] of scope.rawStrings.entries()) {
      const target = RawString(str);
      rawStringList
        .field(`str${i}len`, U8(target.computeBufferSize()))
        .field(`str${i}entry`, target);
    }

    scopeOutput
      .field('rawDataPointer', Pointer16(scopeOutput, 'rawData', Endian.Little))
      .field('rawStringPointer', Pointer16(scopeOutput, 'rawStrings', Endian.Little))

    for (const [i, command] of scope.commands.entries()) {
      scopeOutput.field(`cmd${i}`, commandFactory(command));
    }

    scopeOutput
      .field('rawData', rawDataList)
      .field('rawStrings', rawStringList)

    return scopeOutput;
  }

  const scriptFactory = (item: IScript | IFuncDef) => {
    const script = Struct('script')
      .field('refCount', U8(item.arguments.refCount || 0))
      .field('argCount', U8(item.arguments.length));

    script
      .field('scriptNamePtr', Pointer16(script, 'scriptName', Endian.Little))
      .field('mainScope', scopeFactory(item.scope!))
      .field('scriptName', NullTerminatedString(item.name))

    return script;
  }

  const mainFactory = (scriptStructs: {[key: number]: StructType}, fnStructs: {[key: number]: StructType}, scopeStructs: StructType[]) => {
    const main = Struct('main')
      .field('globalCount', U8(globals.length))
      .field('scriptCount', U8(scripts.length + 1)); // +1 due to main script
    

    // main script
    if (scriptStructs[0]) main.field(`script0Ptr`, Pointer32(main, `script0`, Endian.Little));
    else main.field(`script0Null`, U32(0, Endian.Little));

    for(let i = 0; i < scripts.length; i++) {
      if (scriptStructs[i + 1]) main.field(`script${i + 1}Ptr`, Pointer32(main, `script${i + 1}`, Endian.Little));
      else main.field(`script${i + 1}Null`, U32(0, Endian.Little));
    }

    main.field('fnCount', U8(fns.length));
    for (let i = 0; i < fns.length; i++) {
      if (fnStructs[i]) main.field(`fn${i}Ptr`, Pointer32(main, `fn${i}`, Endian.Little))
      else main.field(`fn${i}Null`, U32(0, Endian.Little));
    }

    main.field('scopeCount', U16(scopeStructs.length, Endian.Little))
    for (const [i, scope] of scopeStructs.entries()) {
      main.field(`scope${i}Ptr`, Pointer32(main, `scope${i}`, Endian.Little));
    }

    // console.log(scriptStructs);
    for (const [i, scr] of Object.entries(scriptStructs)) {
      main.field(`script${i}`, scr);
    }
    for (const [i, fn] of Object.entries(fnStructs)) {
      main.field(`fn${i}`, fn);
    }
    for (const [i, scope] of scopeStructs.entries()) {
      main.field(`scope${i}`, scope);
    }

    return main;
  }
  
  const scriptStructs: {[key: number]: StructType} = {};
  if (mainScript.depth == depthTarget) scriptStructs[0] = scriptFactory(mainScript);
  for (const [idx, script] of scripts.entries()) {
    if (script.depth == depthTarget) scriptStructs[idx + 1] = scriptFactory(script);
  }

  const fnStructs: {[key: number]: StructType} = {};
  for (const [idx, fn] of fns.entries()) {
    if (fn.depth == depthTarget) fnStructs[idx] = scriptFactory(fn);
  }

  const scopeStructs: StructType[] = [];
  for (const scope of anonymousScopes[depthTarget]) {
    scopeStructs.push(scopeFactory(scope));
  }

  const output = mainFactory(scriptStructs, fnStructs, scopeStructs);
  // console.log(output);
  return output.toUint8Array();
}