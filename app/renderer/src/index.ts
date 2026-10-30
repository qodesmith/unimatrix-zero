import './styles.css'

import {App} from '#modules/app/main'
import {followColorScheme} from '#modules/theme/main'
import {createElement} from 'react'
import {createRoot} from 'react-dom/client'

followColorScheme()

const root = document.getElementById('root')

if (!root) throw new Error('index.html has no #root')

createRoot(root).render(createElement(App))
