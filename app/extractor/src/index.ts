import {listenForPort} from '#modules/channel/main'
import {pdfAssetsAt} from '#modules/pdf/main'

listenForPort(globalThis, pdfAssetsAt(location.origin))
