import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { ProductCart } from '../../../../models/product-cart';
import { Order } from '../../../../models/order';
import { LocationService } from '../../../service/location.service';
import { CartService } from '../../../service/cart.service';
import { User } from '../../../../models/user';
import { UserService } from '../../../service/user.service';
import { AuthService } from '../../../service/auth.service';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { InputMaskModule } from 'primeng/inputmask';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { UserPayload } from '../../../../models/selllerPayload';
import { v4 as uuidv4 } from 'uuid';
import { ToastService } from '../../../service/toast.service';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-cart-card',
  imports: [
    CommonModule, FormsModule, InputTextModule, DropdownModule, 
    InputNumberModule, CheckboxModule, InputMaskModule,
  InputGroupModule, InputGroupAddonModule],
  providers: [CartService, ToastService],
  templateUrl: './cart-card.component.html',
  styleUrl: './cart-card.component.scss'
})
export class CartCardComponent implements OnInit {

  @Input() order: Order = {
    id: '',
    products: [],
    address: '',
    paymentType: '',
    changeFrom: 0,
    sellerId: '',
    status: '',
    buyerId: '',
    location: [0, 0]
  };

  paymentTypes = [
    { label: 'Efectivo', value: 'EFECTIVO' },
    { label: 'Transferencia', value: 'TRANSFERENCIA' }
  ];

  createAccount = false;
  rememberAddress = true;

  name = '';
  email = '';
  phone = '';
  password = '';
  confirmPassword = '';

  seller: User | null = null;

  displayFinishOrder: boolean = false;

  role: string = '';

  constructor(
    private readonly locationService: LocationService,
    private readonly cartService: CartService,
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly toastService: ToastService
  ) { }


  ngOnInit(): void {

    //Solicitamos acceso a la ubicación del usuario
    this.locationService.requestPermission().catch((error) => {
      console.error('Error al solicitar permiso de ubicación:', error);
    });

    this.role = this.authService.getValueFromToken('role');
    this.order.address = localStorage.getItem('address') || '';

    this.userService.getUserById(this.order.sellerId).subscribe({
      next: (response: User) => {
        this.seller = response;
      }
    });
  }

  closePreview(): void {
    this.displayFinishOrder = false;
  }

  openFinishOrder(): void {
    this.displayFinishOrder = true;
  }

  getTotal(productsCart: ProductCart[]) {
    return productsCart.reduce((acc, productCart) => acc + productCart.product.price * productCart.quantity, 0);
  }

  // originalPrice can be null
  getTotalDiscount(productsCart: ProductCart[]) {
    return productsCart.reduce((acc, productCart) => {
      const originalPrice = productCart.product.originalPrice || 0;
      const discount = originalPrice - productCart.product.price;
      if (discount <= 0) {
        return acc; // No discount applied
      }
      return acc + (discount * productCart.quantity);
    }, 0);
  }

  increase(product: ProductCart) {
    product.quantity++;
    this.cartService.updateProductQty(this.order.id, product.product.id, product.quantity);
  }

  decrease(product: ProductCart) {
    product.quantity--;
    if (product.quantity <= 0) {
      this.order.products = this.order.products.filter(p => p.product.id !== product.product.id);
    }
    this.cartService.updateProductQty(this.order.id, product.product.id, product.quantity);
  }

  repeatOrder() {
    this.finishOrder();
  }

  finishOrder() {

    if (this.rememberAddress) {
      localStorage.setItem('address', this.order.address);
    } else {
      localStorage.removeItem('address');
    }

    if (this.createAccount) {
      console.log('Crear cuenta nueva');
      const payload: UserPayload = {
        userId: uuidv4(),
        name: this.name,
        businessName: '',
        image: '',
        email: this.email,
        phone: this.phone,
        password: this.password,
        exist: false,
        frontUrl: environment.frontUrl,
        backUrl: environment.apiUrl
      };
      this.authService.createClient(payload).subscribe({
        next: (token: string) => {
          localStorage.setItem('token', token);
          this.role = 'buyer';
          this.finishOrderAndSendWhatsApp();
        },
        error: (err) => {
          this.toastService.showError('Error', err.message);
        }
      });
    } else {
      this.order.buyerId = this.authService.getValueFromToken('userId');
      this.finishOrderAndSendWhatsApp();
    }
  }

  finishOrderAndSendWhatsApp() {
    this.getLocation()
      .then((location) => {
        this.order.location = location;
        this.continueOrder();
      })
      .catch((error) => {
        this.continueOrder();
      });
  }

  continueOrder() {
    const urlWhatsApp = this.generarMensajeWhatsApp(this.order);

    // Enviar orden al backend
    this.cartService.sendOrder(this.order).subscribe({
      next: (response) => {
        this.cartService.deleteOrder(this.order.id);
        this.openWhatsApp(urlWhatsApp);
      },
      error: (err) => {
        console.error(err);
        this.openWhatsApp(urlWhatsApp);
      }
    });
  }

  openWhatsApp(urlWhatsApp: string) {
    window.open(urlWhatsApp, '_blank')

    this.displayFinishOrder = false;

    window.location.reload();
  }

  deleteOrder() {
    this.cartService.deleteOrder(this.order.id);
    this.order.products = [];
  }

  async getLocation(): Promise<[number, number]> {
    try {
      const location = await this.locationService.getCurrentLocation();
      return [location.latitude, location.longitude];
    } catch (error) {
      return [0, 0];
    }
  }


  generarMensajeWhatsApp(order: Order): string {
    const products = order.products
      .map(
        (productCart) =>
          `■ ${productCart.product.name} x ${productCart.quantity} = ${this.formatCurrency(productCart.product.price * productCart.quantity)}`
      )
      .join('\n');

    let payment = `*Pago por:* ${order.paymentType}`;

    if (order.paymentType === 'EFECTIVO') {
      payment += `\n*Cambio de:* ${this.formatCurrency(order.changeFrom)}`;
    }

    let address = ``;

    if (order.location[0] != 0 && order.location[1] != 0) {
      address = `
*Ubicación (Aproximada):* 
https://maps.google.com/?q=${order.location[0]},${order.location[1]}\n`;
    }

    const mensaje = `
*${this.seller?.name}*

*Orden:* ${order.id}

${products}
*Total:* ${this.formatCurrency(order.products.reduce((acc, productCart) => acc + productCart.product.price * productCart.quantity, 0))}

${payment}

*Dirección:* ${order.address}
${address}

*Confirmar orden:*
${environment.frontUrl}/auth/confirm/${order.id}\n
Gracias por tu compra.`.trim();

    // Generar enlace para WhatsApp

    const isMobile = this.isMobileDevice();

    if (isMobile) {
      return `whatsapp://send?phone=${this.seller?.phone}&text=${encodeURIComponent(mensaje)}`;
    } else {
      return `https://wa.me/${this.seller?.phone}?text=${encodeURIComponent(mensaje)}`;
    }

  }

  formatCurrency(value: number): string {
    return `$ ${value.toLocaleString('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    })}`;
  }

  isMobileDevice(): boolean {
    const userAgent = navigator.userAgent;
    // Detectar dispositivos móviles comunes
    return /android|iphone|ipad|ipod/i.test(userAgent);
  }

}



